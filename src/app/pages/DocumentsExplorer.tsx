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
} from "lucide-react";
import { Link } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { documentsService } from "../../services/documentsService";
import { isSessionCacheFresh, readSessionCache, writeSessionCache } from "../../lib/cache";
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
  | { type: "rename-document"; documentId: string; currentTitle: string }
  | { type: "delete-document"; documentId: string; currentTitle: string }
  | { type: "move-document"; documentId: string; currentTitle: string; currentFolderId: string | null }
  | null;

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
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmittingDialog, setIsSubmittingDialog] = useState(false);
  const [dialogState, setDialogState] = useState<ExplorerDialogState>(null);
  const [dialogInputValue, setDialogInputValue] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<string>("root");
  const [error, setError] = useState<string | null>(null);

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
    if (
      readSessionCache("documents.documents") &&
      isSessionCacheFresh("documents.documents", 1000 * 60 * 3) &&
      isSessionCacheFresh("documents.childFolders", 1000 * 60 * 3)
    ) {
      setIsLoading(false);
      return;
    }

    void loadExplorer();
  }, [user, selectedFolderId, search]);

  useEffect(() => {
    writeSessionCache("documents.viewMode", viewMode);
  }, [viewMode]);

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

    setDialogInputValue("");
    setTargetFolderId("root");
  }, [dialogState]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
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
          break;
        }
        case "rename-document": {
          if (!dialogInputValue.trim()) {
            return;
          }
          await documentsService.renameDocument(dialogState.documentId, dialogInputValue.trim());
          break;
        }
        case "delete-document": {
          await documentsService.deleteDocument(dialogState.documentId);
          break;
        }
        case "move-document": {
          await documentsService.moveDocument(
            dialogState.documentId,
            targetFolderId === "root" ? null : targetFolderId,
          );
          break;
        }
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
  const moveTargets = useMemo(
    () => folders.filter((folder) => folder.id !== selectedFolderId),
    [folders, selectedFolderId],
  );

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

      <div className="p-8">
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => setSelectedFolderId(null)} className="hover:text-indigo-600">
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

        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wider">Folders</h2>
            {selectedFolderId ? (
              <button onClick={() => setSelectedFolderId(null)} className="text-sm text-indigo-600">
                View all documents
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {childFolders.map((folder) => (
              <div
                key={folder.id}
                className={`bg-white border rounded-xl p-5 hover:shadow-sm transition-all cursor-pointer ${
                  selectedFolderId === folder.id
                    ? "border-indigo-400"
                    : "border-gray-200 hover:border-indigo-300"
                }`}
                onClick={() => setSelectedFolderId(folder.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Folder className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-medium text-gray-900 mb-1 truncate">{folder.name}</h3>
                      <div className="flex items-center gap-1">
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
                    </div>
                    <p className="text-sm text-gray-500">
                      {folder.childCount} folders • {folder.fileCount} files
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {childFolders.length === 0 && !isLoading ? (
              <div className="col-span-full bg-white border border-dashed border-gray-300 rounded-xl p-6 text-sm text-gray-500">
                No folders here yet. Create one to keep building your study space.
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wider mb-4">Documents</h2>

          {isLoading ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
              Loading documents...
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {visibleDocuments.map((doc) => (
                <Link
                  key={doc.id}
                  to={`/notes/${doc.id}`}
                  className="bg-white border border-gray-200 rounded-xl p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      {getFileIcon(doc.mime_type)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 uppercase">{doc.mime_type.split("/").pop()}</span>
                      {renderDocumentActions(doc)}
                    </div>
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
              ))}
              {visibleDocuments.length === 0 ? (
                <div className="col-span-full bg-white border border-dashed border-gray-300 rounded-xl p-6 text-sm text-gray-500">
                  No documents match this view yet.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {visibleDocuments.map((doc) => (
                <Link
                  key={doc.id}
                  to={`/notes/${doc.id}`}
                  className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                >
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    {getFileIcon(doc.mime_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{doc.title}</div>
                    <div className="text-sm text-gray-500">
                      {doc.mime_type} • {doc.completion_percent}% complete
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {doc.last_opened_at ? new Date(doc.last_opened_at).toLocaleDateString() : "Not studied"}
                  </div>
                  {renderDocumentActions(doc)}
                </Link>
              ))}
              {visibleDocuments.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No documents match this view yet.</div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <Dialog open={Boolean(dialogState)} onOpenChange={(open) => !open && setDialogState(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogState?.type === "create-folder" && "Create Folder"}
              {dialogState?.type === "rename-folder" && "Rename Folder"}
              {dialogState?.type === "delete-folder" && "Delete Folder"}
              {dialogState?.type === "rename-document" && "Rename Document"}
              {dialogState?.type === "delete-document" && "Delete Document"}
              {dialogState?.type === "move-document" && "Move Document"}
            </DialogTitle>
            <DialogDescription>
              {dialogState?.type === "create-folder" && "Create a new folder in the current location."}
              {dialogState?.type === "rename-folder" && "Update the folder name."}
              {dialogState?.type === "delete-folder" && "This removes the folder structure. Documents remain in your library."}
              {dialogState?.type === "rename-document" && "Update the document title shown across the app."}
              {dialogState?.type === "delete-document" && "This removes the document, extracted content, and stored file."}
              {dialogState?.type === "move-document" && "Move this document into another folder or back to the root."}
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

          {dialogState?.type === "move-document" ? (
            <select
              value={targetFolderId}
              onChange={(event) => setTargetFolderId(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="root">Root / My Notes</option>
              {moveTargets.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
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
