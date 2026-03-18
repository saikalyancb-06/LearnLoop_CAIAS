import { supabase } from "../lib/supabaseClient";

export const DOCUMENTS_BUCKET = "documents";

function buildUserStoragePath(userId: string, fileName: string) {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/\s+/g, "-");

  return `${userId}/${timestamp}-${sanitizedFileName}`;
}

export const storageService = {
  async uploadDocumentFile(userId: string, file: File) {
    const storagePath = buildUserStoragePath(userId, file.name);
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

    if (error) {
      throw error;
    }

    return data;
  },

  async removeDocumentFile(storagePath: string) {
    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([storagePath]);

    if (error) {
      throw error;
    }
  },

  async duplicateDocumentFile(input: {
    userId: string;
    sourcePath: string;
    originalFilename: string;
    mimeType: string;
  }) {
    const signedUrl = await this.createSignedDocumentUrl(input.sourcePath);
    const response = await fetch(signedUrl);

    if (!response.ok) {
      throw new Error("Unable to duplicate the stored file.");
    }

    const blob = await response.blob();
    const file = new File([blob], input.originalFilename, {
      type: input.mimeType || blob.type || "application/octet-stream",
    });

    return this.uploadDocumentFile(input.userId, file);
  },

  async createSignedDocumentUrl(storagePath: string, expiresIn = 60 * 15) {
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, expiresIn);

    if (error) {
      throw error;
    }

    return data.signedUrl;
  },
};
