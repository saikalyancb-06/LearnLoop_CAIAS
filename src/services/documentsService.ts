import { supabase } from "../lib/supabaseClient";
import { storageService } from "./storageService";
import { processDocumentFile } from "./documentProcessing";
import { progressService } from "./progressService";
import { localAiService } from "./localAiService";

export const documentsService = {
  async listFolders(userId: string) {
    const [{ data: folders, error: folderError }, { data: documents, error: docError }] =
      await Promise.all([
        supabase
          .from("folders")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: true }),
        supabase.from("documents").select("id, folder_id").eq("user_id", userId),
      ]);

    if (folderError) {
      throw folderError;
    }

    if (docError) {
      throw docError;
    }

    return folders.map((folder) => ({
      ...folder,
      fileCount: documents.filter((document) => document.folder_id === folder.id).length,
    }));
  },

  async getFolderTree(userId: string) {
    const folders = await this.listFolders(userId);

    return folders.map((folder) => ({
      ...folder,
      childCount: folders.filter((candidate) => candidate.parent_folder_id === folder.id).length,
    }));
  },

  async createFolder(userId: string, name: string, parentFolderId?: string | null) {
    const { data, error } = await supabase
      .from("folders")
      .insert({
        user_id: userId,
        name,
        parent_folder_id: parentFolderId ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    await progressService.recordActivity({
      userId,
      title: `Created folder ${name}`,
      activityType: "folder_created",
    });

    return data;
  },

  async renameFolder(folderId: string, name: string) {
    const { data, error } = await supabase
      .from("folders")
      .update({ name })
      .eq("id", folderId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  },

  async deleteFolder(folderId: string) {
    const { error } = await supabase.from("folders").delete().eq("id", folderId);

    if (error) {
      throw error;
    }
  },

  async listDocuments(input: {
    userId: string;
    search?: string;
    folderId?: string | null;
  }) {
    let query = supabase
      .from("documents")
      .select("*")
      .eq("user_id", input.userId)
      .order("updated_at", { ascending: false });

    if (input.folderId) {
      query = query.eq("folder_id", input.folderId);
    }

    if (input.search) {
      query = query.ilike("title", `%${input.search}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data;
  },

  async listFolderContents(input: {
    userId: string;
    folderId?: string | null;
    search?: string;
  }) {
    const [folders, documents] = await Promise.all([
      this.listFolders(input.userId),
      this.listDocuments(input),
    ]);

    const targetFolderId = input.folderId ?? null;
    const lowerSearch = input.search?.toLowerCase().trim() ?? "";

    const childFolders = folders.filter((folder) => folder.parent_folder_id === targetFolderId);
    const visibleFolders = lowerSearch
      ? childFolders.filter((folder) => folder.name.toLowerCase().includes(lowerSearch))
      : childFolders;
    const visibleDocuments =
      targetFolderId === null
        ? lowerSearch
          ? documents
          : documents.filter((document) => document.folder_id === null)
        : documents;

    return {
      allFolders: folders,
      childFolders: visibleFolders,
      documents: visibleDocuments,
    };
  },

  async getFolderPath(folderId: string, allFolders?: Array<any>) {
    const folders = allFolders ?? [];
    const path = [];
    let currentFolder = folders.find((folder) => folder.id === folderId) ?? null;

    while (currentFolder) {
      path.unshift(currentFolder);
      currentFolder =
        folders.find((folder) => folder.id === currentFolder.parent_folder_id) ?? null;
    }

    return path;
  },

  async uploadDocument(input: {
    userId: string;
    file: File;
    folderId?: string | null;
  }) {
    const processed = await processDocumentFile(input.file);
    const aiFlashcards =
      localAiService.isAvailable() && processed.extractedText
        ? await localAiService
            .generateFlashcards({
              title: processed.title,
              extractedText: processed.extractedText,
            })
            .catch(() => null)
        : null;
    const uploadedFile = await storageService.uploadDocumentFile(input.userId, input.file);

    try {
      const { data: document, error: documentError } = await supabase
        .from("documents")
        .insert({
          user_id: input.userId,
          folder_id: input.folderId ?? null,
          title: processed.title,
          original_filename: input.file.name,
          storage_path: uploadedFile.path,
          mime_type: input.file.type,
          file_size_bytes: input.file.size,
          extracted_text: processed.extractedText,
          processing_status: "ready",
          metadata: {
            summary: processed.summary,
            concepts: processed.concepts,
          },
        })
        .select()
        .single();

      if (documentError) {
        throw documentError;
      }

      const sectionsPayload = processed.sections.map((section) => ({
        document_id: document.id,
        title: section.title,
        content: section.content,
        sort_order: section.sortOrder,
      }));

      const flashcardPayload = (aiFlashcards ?? processed.flashcards).map((flashcard, index) => ({
        document_id: document.id,
        user_id: input.userId,
        question: flashcard.question,
        answer: flashcard.answer,
        difficulty:
          "difficulty" in flashcard && flashcard.difficulty === "hard"
            ? "high"
            : "difficulty" in flashcard && flashcard.difficulty === "medium"
              ? "medium"
              : null,
        sort_order: flashcard.sortOrder ?? index,
      }));

      const [{ error: sectionsError }, { error: flashcardsError }] = await Promise.all([
        supabase.from("document_sections").insert(sectionsPayload),
        supabase.from("flashcards").insert(flashcardPayload),
      ]);

      if (sectionsError) {
        throw sectionsError;
      }

      if (flashcardsError) {
        throw flashcardsError;
      }

      await progressService.recordActivity({
        userId: input.userId,
        title: `Uploaded ${processed.title}`,
        activityType: "document_uploaded",
        documentId: document.id,
      });

      await progressService.upsertDailyStats({
        userId: input.userId,
        documentId: document.id,
        studyMinutes: 5,
      });

      await progressService.updateDocumentCompletion(document.id);

      return document;
    } catch (error) {
      await storageService.removeDocumentFile(uploadedFile.path);
      throw error;
    }
  },

  async getDocument(documentId: string) {
    const [{ data: document, error: documentError }, { data: sections, error: sectionsError }] =
      await Promise.all([
        supabase.from("documents").select("*").eq("id", documentId).single(),
        supabase
          .from("document_sections")
          .select("*")
          .eq("document_id", documentId)
          .order("sort_order", { ascending: true }),
      ]);

    if (documentError) {
      throw documentError;
    }

    if (sectionsError) {
      throw sectionsError;
    }

    return {
      ...document,
      sections,
    };
  },

  async updateUserNotes(documentId: string, userNotes: string) {
    const { data, error } = await supabase
      .from("documents")
      .update({ user_notes: userNotes })
      .eq("id", documentId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  },

  async markDocumentOpened(documentId: string) {
    const { data, error } = await supabase
      .from("documents")
      .update({ last_opened_at: new Date().toISOString() })
      .eq("id", documentId)
      .select("id, user_id, title")
      .single();

    if (error) {
      throw error;
    }

    await progressService.recordActivity({
      userId: data.user_id,
      title: `Opened ${data.title}`,
      activityType: "document_opened",
      documentId,
    });

    return data;
  },

  async deleteDocument(documentId: string) {
    const { data: document, error: fetchError } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", documentId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    await storageService.removeDocumentFile(document.storage_path);

    const { error } = await supabase.from("documents").delete().eq("id", documentId);

    if (error) {
      throw error;
    }
  },
};
