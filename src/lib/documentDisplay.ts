const MIME_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "image/png": "PNG",
  "image/jpeg": "JPG",
};

function extensionFromFileName(fileName?: string | null) {
  if (!fileName) {
    return "";
  }

  const parts = fileName.split(".");

  if (parts.length < 2) {
    return "";
  }

  return parts.pop()?.trim().toLowerCase() ?? "";
}

export function getDocumentTypeLabel(mimeType?: string | null, fileName?: string | null) {
  const normalizedMimeType = (mimeType ?? "").trim().toLowerCase();

  if (normalizedMimeType && MIME_TYPE_LABELS[normalizedMimeType]) {
    return MIME_TYPE_LABELS[normalizedMimeType];
  }

  const extension = extensionFromFileName(fileName);

  if (extension) {
    return extension.toUpperCase();
  }

  if (!normalizedMimeType.includes("/")) {
    return "FILE";
  }

  const fallback = normalizedMimeType.split("/").pop() ?? "";

  if (!fallback) {
    return "FILE";
  }

  return fallback
    .replace(/^x-/, "")
    .replace(/^vnd\./, "")
    .split(".")
    .filter(Boolean)
    .slice(-2)
    .join(" ")
    .toUpperCase();
}
