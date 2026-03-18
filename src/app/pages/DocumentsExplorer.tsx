import {
  Search,
  Upload,
  FolderPlus,
  FileText,
  Folder,
  Grid3x3,
  List,
  Pencil,
  Trash2,
  ArrowRightLeft,
  Copy,
  CheckSquare,
  Square,
  ChevronRight,
  ChevronDown,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { documentsService } from "../../services/documentsService";
import {
  isSessionCacheFresh,
  readSessionCache,
  removeSessionCache,
  UI_CACHE_MAX_AGE,
  writeSessionCache,
} from "../../lib/cache";
import { getDocumentTypeLabel } from "../../lib/documentDisplay";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

type ExplorerDialogState =
  | { type: "create-folder" }
  | { type: "rename-folder"; folderId: string; currentName: string }
  | { type: "delete-folder"; folderId: string; currentName: string }
  | { type: "move-folder"; folderId: string; currentName: string; currentParentFolderId: string | null }
  | { type: "duplicate-folder"; folderId: string; currentName: string; currentParentFolderId: string | null }
  | { type: "rename-document"; documentId: string; currentTitle: string }
  | { type: "delete-document"; documentId: string; currentTitle: string }
  | { type: "move-document"; documentId: string; currentTitle: string; currentFolderId: string | null }
  | { type: "duplicate-document"; documentId: string; currentTitle: string; currentFolderId: string | null }
  | { type: "bulk-move" }
  | { type: "bulk-delete" }
  | { type: "bulk-duplicate" }
  | null;

type FolderNode = any & {
  children: FolderNode[];
};

type DragPayload =
  | { kind: "folder"; folderId: string }
  | { kind: "document"; documentId: string };

function buildFolderTree(folders: any[]) {
  const nodeMap = new Map<string, FolderNode>();

  for (const folder of folders) {
    nodeMap.set(folder.id, {
      ...folder,
      children: [],
    });
  }

  const roots: FolderNode[] = [];

  for (const folder of folders) {
    const node = nodeMap.get(folder.id)!;

    if (folder.parent_folder_id && nodeMap.has(folder.parent_folder_id)) {
      nodeMap.get(folder.parent_folder_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
}

function buildFolderPathLabel(folderPath: any[], folderId: string | null) {
  if (!folderId) {
    return "Root / My Notes";
  }

  return [...folderPath.map((folder) => folder.name)].join(" / ") || "Root / My Notes";
}

function buildFolderNameMap(folders: any[]) {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

function buildFolderOptionLabel(folders: any[], folderId: string) {
  const folderMap = buildFolderNameMap(folders);
  const segments: string[] = [];
  let current = folderMap.get(folderId) ?? null;

  while (current) {
    segments.unshift(current.name);
    current = current.parent_folder_id ? folderMap.get(current.parent_folder_id) ?? null : null;
  }

  return segments.join(" / ");
}

function parseDropPayload(event: React.DragEvent) {
  const raw = event.dataTransfer.getData("application/json");

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export function DocumentsExplorer() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">(
    () => readSessionCache("documents.viewMode") ?? "grid",
  );
  const [search, setSearch] = useState(() => readSessionCache("documents.search") ?? "");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() =>
    readSessionCache("documents.folderId"),
  );
  const [folders, setFolders] = useState<any[]>(() => readSessionCache("documents.allFolders") ?? []);
  const [childFolders, setChildFolders] = useState<any[]>(
    () => readSessionCache("documents.childFolders") ?? [],
  );
  const [folderPath, setFolderPath] = useState<any[]>(() => readSessionCache("documents.folderPath") ?? []);
  const [documents, setDocuments] = useState<any[]>(() => readSessionCache("documents.documents") ?? []);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(
    () => readSessionCache("documents.expandedFolders") ?? [],
  );
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>(
    () => readSessionCache("documents.selectedDocuments") ?? [],
  );
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>(
    () => readSessionCache("documents.selectedFolders") ?? [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmittingDialog, setIsSubmittingDialog] = useState(false);
  const [dialogState, setDialogState] = useState<ExplorerDialogState>(null);
  const [dialogInputValue, setDialogInputValue] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<string>("root");
  const [error, setError] = useState<string | null>(null);

  const invalidateDashboardCache = () => {
    removeSessionCache("dashboard.documents");
    removeSessionCache("dashboard.sessions");
    removeSessionCache("dashboard.summary");
  };

  async function loadExplorer() {
    if (!user) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [nextFolders, nextDocuments] = await Promise.all([
        documentsService.getFolderTree(user.id),
        documentsService.listFolderContents({
          userId: user.id,
          folderId: selectedFolderId,
          search,
        }),
      ]);

      setFolders(nextFolders);
      setChildFolders(nextDocuments.childFolders);
      setDocuments(nextDocuments.documents);
      const nextFolderPath = selectedFolderId
        ? await documentsService.getFolderPath(selectedFolderId, nextDocuments.allFolders)
        : [];
      setFolderPath(nextFolderPath);
      writeSessionCache("documents.allFolders", nextFolders);
      writeSessionCache("documents.childFolders", nextDocuments.childFolders);
      writeSessionCache("documents.documents", nextDocuments.documents);
      writeSessionCache("documents.folderPath", nextFolderPath);
      writeSessionCache("documents.search", search);
      writeSessionCache("documents.folderId", selectedFolderId);
      writeSessionCache("documents.viewMode", viewMode);
    } catch (explorerError) {
      setError(
        explorerError instanceof Error
          ? explorerError.message
          : "Unable to load your documents.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const cachedFolderId = readSessionCache<string | null>("documents.folderId");
    const cachedSearch = readSessionCache<string>("documents.search") ?? "";
    const hasFreshCache =
      readSessionCache("documents.documents") &&
      isSessionCacheFresh("documents.documents", UI_CACHE_MAX_AGE) &&
      isSessionCacheFresh("documents.childFolders", UI_CACHE_MAX_AGE) &&
      isSessionCacheFresh("documents.folderPath", UI_CACHE_MAX_AGE) &&
      isSessionCacheFresh("documents.allFolders", UI_CACHE_MAX_AGE);

    if (
      hasFreshCache &&
      cachedFolderId === selectedFolderId &&
      cachedSearch === search
    ) {
      setFolders(readSessionCache("documents.allFolders") ?? []);
      setChildFolders(readSessionCache("documents.childFolders") ?? []);
      setDocuments(readSessionCache("documents.documents") ?? []);
      setFolderPath(readSessionCache("documents.folderPath") ?? []);
      setIsLoading(false);
      return;
    }

    void loadExplorer();
  }, [user, selectedFolderId, search]);

  useEffect(() => {
    writeSessionCache("documents.viewMode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    writeSessionCache("documents.expandedFolders", expandedFolderIds);
  }, [expandedFolderIds]);

  useEffect(() => {
    writeSessionCache("documents.selectedDocuments", selectedDocumentIds);
  }, [selectedDocumentIds]);

  useEffect(() => {
    writeSessionCache("documents.selectedFolders", selectedFolderIds);
  }, [selectedFolderIds]);

  useEffect(() => {
    if (folderPath.length === 0) {
      return;
    }

    setExpandedFolderIds((current) => [...new Set([...current, ...folderPath.map((folder) => folder.id)])]);
  }, [folderPath]);

  useEffect(() => {
    if (!dialogState) {
      setDialogInputValue("");
      setTargetFolderId("root");
      return;
    }

    if (dialogState.type === "rename-folder") {
      setDialogInputValue(dialogState.currentName);
      return;
    }

    if (dialogState.type === "rename-document") {
      setDialogInputValue(dialogState.currentTitle);
      return;
    }

    if (dialogState.type === "move-document") {
      setTargetFolderId(dialogState.currentFolderId ?? "root");
      return;
    }

    if (dialogState.type === "move-folder") {
      setTargetFolderId(dialogState.currentParentFolderId ?? "root");
      return;
    }

    if (dialogState.type === "duplicate-document") {
      setTargetFolderId(dialogState.currentFolderId ?? "root");
      return;
    }

    if (dialogState.type === "duplicate-folder") {
      setTargetFolderId(dialogState.currentParentFolderId ?? "root");
      return;
    }

    if (dialogState.type === "bulk-move" || dialogState.type === "bulk-duplicate") {
      setTargetFolderId(selectedFolderId ?? "root");
      return;
    }

    setDialogInputValue("");
    setTargetFolderId("root");
  }, [dialogState, selectedFolderId]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const clearSelection = () => {
    setSelectedDocumentIds([]);
    setSelectedFolderIds([]);
  };

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file || !user) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      await documentsService.uploadDocument({
        userId: user.id,
        file,
        folderId: selectedFolderId,
      });
      invalidateDashboardCache();
      await loadExplorer();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Unable to upload the document.",
      );
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleDialogSubmit = async () => {
    if (!dialogState || !user) {
      return;
    }

    setIsSubmittingDialog(true);
    setError(null);

    try {
      let didChangeDashboardDocuments = false;

      switch (dialogState.type) {
        case "create-folder": {
          if (!dialogInputValue.trim()) {
            return;
          }
          await documentsService.createFolder(user.id, dialogInputValue.trim(), selectedFolderId);
          break;
        }
        case "rename-folder": {
          if (!dialogInputValue.trim()) {
            return;
          }
          await documentsService.renameFolder(dialogState.folderId, dialogInputValue.trim());
          break;
        }
        case "delete-folder": {
          await documentsService.deleteFolder(dialogState.folderId);
          if (selectedFolderId === dialogState.folderId) {
            setSelectedFolderId(null);
          }
          setSelectedFolderIds((current) => current.filter((id) => id !== dialogState.folderId));
          break;
        }
        case "move-folder": {
          await documentsService.moveFolder({
            folderId: dialogState.folderId,
            userId: user.id,
            targetFolderId: targetFolderId === "root" ? null : targetFolderId,
          });
          break;
        }
        case "duplicate-folder": {
          await documentsService.duplicateFolder({
            folderId: dialogState.folderId,
            userId: user.id,
            targetFolderId: targetFolderId === "root" ? null : targetFolderId,
          });
          break;
        }
        case "rename-document": {
          if (!dialogInputValue.trim()) {
            return;
          }
          await documentsService.renameDocument(dialogState.documentId, dialogInputValue.trim());
          didChangeDashboardDocuments = true;
          break;
        }
        case "delete-document": {
          await documentsService.deleteDocument(dialogState.documentId);
          setSelectedDocumentIds((current) => current.filter((id) => id !== dialogState.documentId));
          didChangeDashboardDocuments = true;
          break;
        }
        case "move-document": {
          await documentsService.moveDocument(
            dialogState.documentId,
            targetFolderId === "root" ? null : targetFolderId,
          );
          didChangeDashboardDocuments = true;
          break;
        }
        case "duplicate-document": {
          await documentsService.duplicateDocument({
            documentId: dialogState.documentId,
            userId: user.id,
            targetFolderId: targetFolderId === "root" ? null : targetFolderId,
          });
          didChangeDashboardDocuments = true;
          break;
        }
        case "bulk-move": {
          if (selectedFolderIds.length > 0) {
            await documentsService.bulkMoveFolders({
              folderIds: selectedFolderIds,
              userId: user.id,
              targetFolderId: targetFolderId === "root" ? null : targetFolderId,
            });
          }

          if (selectedDocumentIds.length > 0) {
            await documentsService.bulkMoveDocuments(
              selectedDocumentIds,
              targetFolderId === "root" ? null : targetFolderId,
            );
            didChangeDashboardDocuments = true;
          }

          clearSelection();
          break;
        }
        case "bulk-delete": {
          if (selectedFolderIds.length > 0) {
            await documentsService.bulkDeleteFolders(selectedFolderIds);
          }

          if (selectedDocumentIds.length > 0) {
            await documentsService.bulkDeleteDocuments(selectedDocumentIds);
            didChangeDashboardDocuments = true;
          }

          clearSelection();
          break;
        }
        case "bulk-duplicate": {
          if (selectedFolderIds.length > 0) {
            await documentsService.bulkDuplicateFolders({
              folderIds: selectedFolderIds,
              userId: user.id,
              targetFolderId: targetFolderId === "root" ? null : targetFolderId,
            });
          }

          if (selectedDocumentIds.length > 0) {
            await documentsService.bulkDuplicateDocuments({
              documentIds: selectedDocumentIds,
              userId: user.id,
              targetFolderId: targetFolderId === "root" ? null : targetFolderId,
            });
            didChangeDashboardDocuments = true;
          }

          clearSelection();
          break;
        }
      }

      if (didChangeDashboardDocuments) {
        invalidateDashboardCache();
      }

      setDialogState(null);
      await loadExplorer();
    } catch (dialogError) {
      setError(
        dialogError instanceof Error
          ? dialogError.message
          : "Unable to complete that action.",
      );
    } finally {
      setIsSubmittingDialog(false);
    }
  };

  const visibleDocuments = useMemo(() => documents, [documents]);
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const selectedCount = selectedDocumentIds.length + selectedFolderIds.length;
  const allFolderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);

  const moveTargets = useMemo(() => {
    const blockedFolderIds = new Set<string>();

    if (dialogState?.type === "move-folder") {
      blockedFolderIds.add(dialogState.folderId);
    }

    for (const folderId of selectedFolderIds) {
      blockedFolderIds.add(folderId);
    }

    return folders.filter((folder) => !blockedFolderIds.has(folder.id));
  }, [dialogState, folders, selectedFolderIds]);

  const toggleExpanded = (folderId: string) => {
    setExpandedFolderIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
    );
  };

  const toggleFolderSelection = (folderId: string) => {
    setSelectedFolderIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
    );
  };

  const toggleDocumentSelection = (documentId: string) => {
    setSelectedDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  };

  const selectAllVisible = () => {
    setSelectedFolderIds(childFolders.map((folder) => folder.id));
    setSelectedDocumentIds(visibleDocuments.map((document) => document.id));
  };

  const handleDropOnFolder = async (event: React.DragEvent, targetFolderId: string | null) => {
    event.preventDefault();
    const payload = parseDropPayload(event);

    if (!payload || !user) {
      return;
    }

    try {
      if (payload.kind === "folder") {
        await documentsService.moveFolder({
          folderId: payload.folderId,
          userId: user.id,
          targetFolderId,
        });
      } else {
        await documentsService.moveDocument(payload.documentId, targetFolderId);
        invalidateDashboardCache();
      }

      await loadExplorer();
    } catch (dropError) {
      setError(dropError instanceof Error ? dropError.message : "Unable to move item.");
    }
  };

  const getFileIcon = (type: string) => {
    const iconClass = "w-5 h-5";
    switch (type) {
      case "application/pdf":
        return <FileText className={`${iconClass} text-red-600`} />;
      case "application/msword":
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return <FileText className={`${iconClass} text-blue-600`} />;
      case "application/vnd.ms-powerpoint":
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return <FileText className={`${iconClass} text-orange-600`} />;
      case "image/png":
      case "image/jpeg":
        return <FileText className={`${iconClass} text-green-600`} />;
      default:
        return <FileText className={iconClass} />;
    }
  };

  const renderFolderActions = (folder: any) => (
    <div className="flex items-center gap-1">
      <button
        onClick={(event) => {
          event.stopPropagation();
          setDialogState({
            type: "move-folder",
            folderId: folder.id,
            currentName: folder.name,
            currentParentFolderId: folder.parent_folder_id,
          });
        }}
        className="p-1 text-gray-400 hover:text-gray-700"
      >
        <ArrowRightLeft className="w-4 h-4" />
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setDialogState({
            type: "duplicate-folder",
            folderId: folder.id,
            currentName: folder.name,
            currentParentFolderId: folder.parent_folder_id,
          });
        }}
        className="p-1 text-gray-400 hover:text-gray-700"
      >
        <Copy className="w-4 h-4" />
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setDialogState({
            type: "rename-folder",
            folderId: folder.id,
            currentName: folder.name,
          });
        }}
        className="p-1 text-gray-400 hover:text-gray-700"
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setDialogState({
            type: "delete-folder",
            folderId: folder.id,
            currentName: folder.name,
          });
        }}
        className="p-1 text-gray-400 hover:text-red-600"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );

  const renderDocumentActions = (doc: any) => (
    <div className="flex items-center gap-1">
      <button
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDialogState({
            type: "move-document",
            documentId: doc.id,
            currentTitle: doc.title,
            currentFolderId: doc.folder_id,
          });
        }}
        className="p-1 text-gray-400 hover:text-gray-700"
      >
        <ArrowRightLeft className="w-4 h-4" />
      </button>
      <button
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDialogState({
            type: "duplicate-document",
            documentId: doc.id,
            currentTitle: doc.title,
            currentFolderId: doc.folder_id,
          });
        }}
        className="p-1 text-gray-400 hover:text-gray-700"
      >
        <Copy className="w-4 h-4" />
      </button>
      <button
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDialogState({
            type: "rename-document",
            documentId: doc.id,
            currentTitle: doc.title,
          });
        }}
        className="p-1 text-gray-400 hover:text-gray-700"
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDialogState({
            type: "delete-document",
            documentId: doc.id,
            currentTitle: doc.title,
          });
        }}
        className="p-1 text-gray-400 hover:text-red-600"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );

  const renderTreeNode = (node: FolderNode, depth = 0): React.ReactNode => {
    const isExpanded = expandedFolderIds.includes(node.id);
    const isSelected = selectedFolderId === node.id;
    const isChecked = selectedFolderIds.includes(node.id);
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id} className="select-none">
        <div
          className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${
            isSelected ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-100"
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void handleDropOnFolder(event, node.id)}
        >
          <button
            type="button"
            onClick={() => (hasChildren ? toggleExpanded(node.id) : setSelectedFolderId(node.id))}
            className="flex h-5 w-5 items-center justify-center text-gray-400"
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <span className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => toggleFolderSelection(node.id)}
            className="text-gray-400 hover:text-indigo-600"
          >
            {isChecked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(
                "application/json",
                JSON.stringify({ kind: "folder", folderId: node.id } satisfies DragPayload),
              );
            }}
            onClick={() => setSelectedFolderId(node.id)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Folder className="h-4 w-4 flex-shrink-0 text-indigo-600" />
            <span className="truncate">{node.name}</span>
          </button>
        </div>
        {isExpanded ? node.children.map((child) => renderTreeNode(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto">
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">My Notes</h1>
            <p className="text-sm text-gray-500 mt-1">Organize and access your study materials</p>
          </div>
          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg"
              onChange={handleUploadChange}
            />
            <button
              onClick={handleUploadClick}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>{isUploading ? "Uploading..." : "Upload Document"}</span>
            </button>
            <button
              onClick={() => setDialogState({ type: "create-folder" })}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
              <span>New Folder</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search documents and folders..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-1 border border-gray-300 rounded-lg p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded ${viewMode === "grid" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            >
              <Grid3x3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 rounded ${viewMode === "list" ? "bg-gray-100" : "hover:bg-gray-50"}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      <div className="px-8 pb-8 pt-6">
        {selectedCount > 0 ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
            <div className="text-sm text-indigo-900">
              {selectedCount} item{selectedCount === 1 ? "" : "s"} selected
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setDialogState({ type: "bulk-move" })}
                className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
              >
                Move
              </button>
              <button
                onClick={() => setDialogState({ type: "bulk-duplicate" })}
                className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
              >
                Duplicate
              </button>
              <button
                onClick={() => setDialogState({ type: "bulk-delete" })}
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
              <button
                onClick={clearSelection}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <button
            onClick={() => setSelectedFolderId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleDropOnFolder(event, null)}
            className="hover:text-indigo-600"
          >
            My Notes
          </button>
          {folderPath.map((folder) => (
            <div key={folder.id} className="flex items-center gap-2">
              <span>/</span>
              <button onClick={() => setSelectedFolderId(folder.id)} className="hover:text-indigo-600">
                {folder.name}
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-6 lg:min-h-[calc(100vh-240px)] lg:flex-row lg:gap-0">
          <aside className="lg:w-64 lg:flex-shrink-0 xl:w-72">
            <div className="h-full rounded-l-2xl border border-gray-200 bg-white p-4 lg:sticky lg:top-6 lg:min-h-[calc(100vh-240px)] lg:rounded-r-none lg:border-r-0">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-sm font-medium uppercase tracking-wider text-gray-700">Folders</h2>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right">
                <button
                  onClick={selectAllVisible}
                  className="text-xs text-indigo-600 hover:text-indigo-700"
                >
                  Select visible
                </button>
                <button
                  onClick={() => setExpandedFolderIds(allFolderIds)}
                  className="text-xs text-indigo-600 hover:text-indigo-700"
                >
                  Expand all
                </button>
                <button
                  onClick={() => setExpandedFolderIds([])}
                  className="text-xs text-indigo-600 hover:text-indigo-700"
                >
                  Collapse all
                </button>
              </div>
            </div>
            <div
              className={`mb-3 rounded-xl border px-3 py-2 text-sm ${
                selectedFolderId === null ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-700"
              }`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void handleDropOnFolder(event, null)}
            >
              <button onClick={() => setSelectedFolderId(null)} className="flex w-full items-center gap-2 text-left">
                <Folder className="h-4 w-4 text-indigo-600" />
                <span>Root / My Notes</span>
              </button>
            </div>
            <div className="max-h-[calc(100vh-340px)] space-y-1 overflow-auto pr-1">
              {folderTree.map((node) => renderTreeNode(node))}
              {folderTree.length === 0 && !isLoading ? (
                <div className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                  No folders yet.
                </div>
              ) : null}
            </div>
            </div>
          </aside>

          <div className="min-w-0 flex-1 overflow-hidden rounded-r-2xl border border-gray-200 bg-white p-6 lg:rounded-l-none">
            <div className="mb-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wider">Folders</h2>
                {selectedFolderId ? (
                  <button onClick={() => setSelectedFolderId(null)} className="text-sm text-indigo-600">
                    View all documents
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {childFolders.map((folder) => {
                  const isChecked = selectedFolderIds.includes(folder.id);

                  return (
                    <div
                      key={folder.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(
                          "application/json",
                          JSON.stringify({ kind: "folder", folderId: folder.id } satisfies DragPayload),
                        );
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => void handleDropOnFolder(event, folder.id)}
                      className={`bg-white border rounded-xl p-5 hover:shadow-sm transition-all cursor-pointer ${
                        selectedFolderId === folder.id
                          ? "border-indigo-400"
                          : "border-gray-200 hover:border-indigo-300"
                      }`}
                      onClick={() => setSelectedFolderId(folder.id)}
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFolderSelection(folder.id);
                          }}
                          className="text-gray-400 hover:text-indigo-600"
                        >
                          {isChecked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                        </button>
                        {renderFolderActions(folder)}
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Folder className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-900 mb-1 truncate">{folder.name}</h3>
                          <p className="text-sm text-gray-500">
                            {folder.childCount} folders • {folder.fileCount} files
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {childFolders.length === 0 && !isLoading ? (
                  <div className="col-span-full bg-white border border-dashed border-gray-300 rounded-xl p-6 text-sm text-gray-500">
                    No folders here yet. Create one to keep building your study space.
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wider">Documents</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={selectAllVisible}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Select visible
                  </button>
                  {selectedCount > 0 ? (
                    <button
                      onClick={clearSelection}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2"><X className="h-4 w-4" /> Clear selection</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {isLoading ? (
                <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
                  Loading documents...
                </div>
              ) : viewMode === "grid" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {visibleDocuments.map((doc) => {
                    const isChecked = selectedDocumentIds.includes(doc.id);

                    return (
                      <div
                        key={doc.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/json",
                            JSON.stringify({ kind: "document", documentId: doc.id } satisfies DragPayload),
                          );
                        }}
                        className="bg-white border border-gray-200 rounded-xl p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
                      >
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => toggleDocumentSelection(doc.id)}
                            className="text-gray-400 hover:text-indigo-600"
                          >
                            {isChecked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                          </button>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-indigo-700">
                              {getDocumentTypeLabel(doc.mime_type, doc.original_filename)}
                            </span>
                            {renderDocumentActions(doc)}
                          </div>
                        </div>
                        <Link to={`/notes/${doc.id}`} className="block">
                          <div className="mb-3 w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                            {getFileIcon(doc.mime_type)}
                          </div>
                          <h3 className="font-medium text-gray-900 mb-2 line-clamp-2">{doc.title}</h3>
                          <div className="flex items-center justify-between text-sm mb-3">
                            <span className="text-gray-500">Progress</span>
                            <span className="font-medium text-indigo-600">{doc.completion_percent}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                            <div
                              className="bg-indigo-600 h-2 rounded-full"
                              style={{ width: `${doc.completion_percent}%` }}
                            ></div>
                          </div>
                          <p className="text-xs text-gray-500">
                            Last studied {doc.last_opened_at ? new Date(doc.last_opened_at).toLocaleString() : "Not yet"}
                          </p>
                        </Link>
                      </div>
                    );
                  })}
                  {visibleDocuments.length === 0 ? (
                    <div className="col-span-full bg-white border border-dashed border-gray-300 rounded-xl p-6 text-sm text-gray-500">
                      No documents match this view yet.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {visibleDocuments.map((doc) => {
                    const isChecked = selectedDocumentIds.includes(doc.id);

                    return (
                      <div
                        key={doc.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/json",
                            JSON.stringify({ kind: "document", documentId: doc.id } satisfies DragPayload),
                          );
                        }}
                        className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                      >
                        <button
                          type="button"
                          onClick={() => toggleDocumentSelection(doc.id)}
                          className="text-gray-400 hover:text-indigo-600"
                        >
                          {isChecked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                        </button>
                        <Link to={`/notes/${doc.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                            {getFileIcon(doc.mime_type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">{doc.title}</div>
                            <div className="text-sm text-gray-500">
                              {getDocumentTypeLabel(doc.mime_type, doc.original_filename)} • {doc.completion_percent}% complete
                            </div>
                          </div>
                        </Link>
                        <div className="text-sm text-gray-500">
                          {doc.last_opened_at ? new Date(doc.last_opened_at).toLocaleDateString() : "Not studied"}
                        </div>
                        {renderDocumentActions(doc)}
                      </div>
                    );
                  })}
                  {visibleDocuments.length === 0 ? (
                    <div className="p-6 text-sm text-gray-500">No documents match this view yet.</div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(dialogState)} onOpenChange={(open) => !open && setDialogState(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogState?.type === "create-folder" && "Create Folder"}
              {dialogState?.type === "rename-folder" && "Rename Folder"}
              {dialogState?.type === "delete-folder" && "Delete Folder"}
              {dialogState?.type === "move-folder" && "Move Folder"}
              {dialogState?.type === "duplicate-folder" && "Duplicate Folder"}
              {dialogState?.type === "rename-document" && "Rename Document"}
              {dialogState?.type === "delete-document" && "Delete Document"}
              {dialogState?.type === "move-document" && "Move Document"}
              {dialogState?.type === "duplicate-document" && "Duplicate Document"}
              {dialogState?.type === "bulk-move" && "Move Selected Items"}
              {dialogState?.type === "bulk-delete" && "Delete Selected Items"}
              {dialogState?.type === "bulk-duplicate" && "Duplicate Selected Items"}
            </DialogTitle>
            <DialogDescription>
              {dialogState?.type === "create-folder" && "Create a new folder in the current location."}
              {dialogState?.type === "rename-folder" && "Update the folder name."}
              {dialogState?.type === "delete-folder" && "This removes the folder structure. Documents remain in your library."}
              {dialogState?.type === "move-folder" && "Move this folder into another folder or back to the root."}
              {dialogState?.type === "duplicate-folder" && "Create a recursive copy of this folder and everything inside it."}
              {dialogState?.type === "rename-document" && "Update the document title shown across the app."}
              {dialogState?.type === "delete-document" && "This removes the document, extracted content, and stored file."}
              {dialogState?.type === "move-document" && "Move this document into another folder or back to the root."}
              {dialogState?.type === "duplicate-document" && "Create a copied document with duplicated file content."}
              {dialogState?.type === "bulk-move" && "Move all selected folders and documents together."}
              {dialogState?.type === "bulk-delete" && "Delete all selected folders and documents."}
              {dialogState?.type === "bulk-duplicate" && "Duplicate all selected folders and documents."}
            </DialogDescription>
          </DialogHeader>

          {dialogState?.type === "create-folder" ||
          dialogState?.type === "rename-folder" ||
          dialogState?.type === "rename-document" ? (
            <input
              type="text"
              value={dialogInputValue}
              onChange={(event) => setDialogInputValue(event.target.value)}
              placeholder="Enter a name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          ) : null}

          {dialogState?.type === "move-document" ||
          dialogState?.type === "move-folder" ||
          dialogState?.type === "duplicate-document" ||
          dialogState?.type === "duplicate-folder" ||
          dialogState?.type === "bulk-move" ||
          dialogState?.type === "bulk-duplicate" ? (
            <select
              value={targetFolderId}
              onChange={(event) => setTargetFolderId(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="root">{buildFolderPathLabel([], null)}</option>
              {moveTargets.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {buildFolderOptionLabel(folders, folder.id) || folder.name}
                </option>
              ))}
            </select>
          ) : null}

          {dialogState?.type === "delete-folder" ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              Delete folder "{dialogState.currentName}"?
            </div>
          ) : null}

          {dialogState?.type === "delete-document" ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              Delete document "{dialogState.currentTitle}"?
            </div>
          ) : null}

          {dialogState?.type === "bulk-delete" ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              Delete {selectedFolderIds.length} folder(s) and {selectedDocumentIds.length} document(s)?
            </div>
          ) : null}

          <DialogFooter>
            <button
              type="button"
              onClick={() => setDialogState(null)}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDialogSubmit()}
              disabled={
                isSubmittingDialog ||
                ((dialogState?.type === "create-folder" ||
                  dialogState?.type === "rename-folder" ||
                  dialogState?.type === "rename-document") &&
                  !dialogInputValue.trim())
              }
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmittingDialog ? "Saving..." : "Confirm"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
