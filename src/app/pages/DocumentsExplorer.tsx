import { Search, Upload, FolderPlus, FileText, Folder, Grid3x3, List, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { documentsService } from "../../services/documentsService";
import { isSessionCacheFresh, readSessionCache, writeSessionCache } from "../../lib/cache";

export function DocumentsExplorer() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => readSessionCache("documents.viewMode") ?? "grid");
  const [search, setSearch] = useState(() => readSessionCache("documents.search") ?? "");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() => readSessionCache("documents.folderId"));
  const [folders, setFolders] = useState<any[]>(() => readSessionCache("documents.allFolders") ?? []);
  const [childFolders, setChildFolders] = useState<any[]>(() => readSessionCache("documents.childFolders") ?? []);
  const [folderPath, setFolderPath] = useState<any[]>(() => readSessionCache("documents.folderPath") ?? []);
  const [documents, setDocuments] = useState<any[]>(() => readSessionCache("documents.documents") ?? []);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
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
      const nextFolderPath =
        selectedFolderId ? await documentsService.getFolderPath(selectedFolderId, nextDocuments.allFolders) : [];
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

  const handleCreateFolder = async () => {
    if (!user) {
      return;
    }

    const name = window.prompt("Folder name");

    if (!name?.trim()) {
      return;
    }

    await documentsService.createFolder(user.id, name.trim(), selectedFolderId);
    await loadExplorer();
  };

  const handleRenameFolder = async (folderId: string, currentName: string) => {
    const nextName = window.prompt("Rename folder", currentName);

    if (!nextName?.trim()) {
      return;
    }

    await documentsService.renameFolder(folderId, nextName.trim());
    await loadExplorer();
  };

  const handleDeleteFolder = async (folderId: string) => {
    const confirmed = window.confirm("Delete this folder? Documents stay in your library.");

    if (!confirmed) {
      return;
    }

    await documentsService.deleteFolder(folderId);

    if (selectedFolderId === folderId) {
      setSelectedFolderId(null);
    }

    await loadExplorer();
  };

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
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload the document.",
      );
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const visibleDocuments = useMemo(() => documents, [documents]);

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
              onClick={handleCreateFolder}
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
                  selectedFolderId === folder.id ? "border-indigo-400" : "border-gray-200 hover:border-indigo-300"
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
                            void handleRenameFolder(folder.id, folder.name);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-700"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteFolder(folder.id);
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
                    <span className="text-xs text-gray-500 uppercase">{doc.mime_type.split("/").pop()}</span>
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
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Progress
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Studied
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link to={`/notes/${doc.id}`} className="flex items-center gap-3 text-gray-900 hover:text-indigo-600">
                          <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                            {getFileIcon(doc.mime_type)}
                          </div>
                          <span className="font-medium">{doc.title}</span>
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-500 uppercase">{doc.mime_type.split("/").pop()}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-32 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-indigo-600 h-2 rounded-full"
                              style={{ width: `${doc.completion_percent}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium text-indigo-600">{doc.completion_percent}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {doc.last_opened_at ? new Date(doc.last_opened_at).toLocaleString() : "Not yet"}
                      </td>
                    </tr>
                  ))}
                  {visibleDocuments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                        No documents match this view yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
