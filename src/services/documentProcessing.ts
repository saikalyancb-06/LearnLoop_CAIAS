import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export const SUPPORTED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
] as const;

export type MindMapConcept = {
  id: string;
  label: string;
  x: number;
  y: number;
};

export type ProcessedSection = {
  title: string;
  content: string;
  sortOrder: number;
};

export type GeneratedFlashcard = {
  question: string;
  answer: string;
  sortOrder: number;
};

export type ProcessedDocument = {
  title: string;
  extractedText: string;
  sections: ProcessedSection[];
  concepts: MindMapConcept[];
  flashcards: GeneratedFlashcard[];
  summary: string;
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "have",
  "will",
  "about",
  "what",
  "when",
  "where",
  "which",
  "while",
  "these",
  "those",
  "then",
  "than",
  "them",
  "they",
  "their",
  "there",
  "been",
  "being",
  "were",
  "also",
  "because",
  "through",
  "under",
  "between",
  "after",
  "before",
  "document",
  "slide",
  "notes",
]);

function normalizeTitle(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoSentences(text: string) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function chunkText(text: string, maxLength = 900) {
  const paragraphs = normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if ((currentChunk + "\n\n" + paragraph).length > maxLength && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
      continue;
    }

    currentChunk = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

function buildSummaryFromText(text: string, title: string, fileType: string) {
  const sentences = splitIntoSentences(text).slice(0, 3);

  if (sentences.length > 0) {
    return sentences.join(" ");
  }

  return `${title} was uploaded as a ${fileType}. LearnLoop extracted its visible content and prepared it for study.`;
}

function extractKeywords(text: string, title: string) {
  const source = `${title} ${text}`.toLowerCase();
  const counts = new Map<string, number>();

  for (const token of source.match(/[a-zA-Z][a-zA-Z-]{2,}/g) ?? []) {
    if (STOP_WORDS.has(token)) {
      continue;
    }

    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word.replace(/^\w/, (char) => char.toUpperCase()));
}

function buildSectionsFromText(text: string, title: string): ProcessedSection[] {
  const chunks = chunkText(text);

  return chunks.slice(0, 6).map((chunk, index) => ({
    title: index === 0 ? "Overview" : `Section ${index + 1}`,
    content: chunk,
    sortOrder: index,
  }));
}

function buildConcepts(title: string, keywords: string[]): MindMapConcept[] {
  const labels = [title, ...keywords].slice(0, 4);
  const coordinates = [
    { x: 50, y: 20 },
    { x: 30, y: 50 },
    { x: 70, y: 50 },
    { x: 50, y: 80 },
  ];

  return labels.map((label, index) => ({
    id: `${index + 1}`,
    label,
    x: coordinates[index]?.x ?? 50,
    y: coordinates[index]?.y ?? 50,
  }));
}

function summarizeChunk(chunk: string, fallback: string) {
  const sentences = splitIntoSentences(chunk).slice(0, 2);
  return sentences.join(" ") || fallback;
}

export function generateFlashcardsFromText(text: string, title: string): GeneratedFlashcard[] {
  const chunks = chunkText(text, 500);
  const keywords = extractKeywords(text, title);

  const flashcardsFromChunks = chunks.slice(0, 4).map((chunk, index) => {
    const keyword = keywords[index] ?? keywords[0] ?? title;

    return {
      sortOrder: index,
      question: `How does ${keyword} relate to ${title}?`,
      answer: summarizeChunk(
        chunk,
        `${keyword} is one of the main ideas discussed in ${title}. Review the extracted section content to explain it in your own words.`,
      ),
    };
  });

  return flashcardsFromChunks.length > 0
    ? flashcardsFromChunks
    : [
        {
          sortOrder: 0,
          question: `What is the main idea of ${title}?`,
          answer: `Review the uploaded content and summarize the key concept in your own words.`,
        },
      ];
}

async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    pages.push(normalizeWhitespace(pageText));
  }

  return pages.join("\n\n");
}

async function extractDocxText(file: File) {
  const mammoth = await import("mammoth");
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return normalizeWhitespace(result.value);
}

async function extractPptxText(file: File) {
  const [{ default: JSZip }, { XMLParser }] = await Promise.all([
    import("jszip"),
    import("fast-xml-parser"),
  ]);
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const slides: string[] = [];

  function collectText(node: unknown, output: string[]) {
    if (!node) {
      return;
    }

    if (typeof node === "string") {
      output.push(node);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item) => collectText(item, output));
      return;
    }

    if (typeof node === "object") {
      Object.entries(node).forEach(([key, value]) => {
        if (key === "a:t" || key === "t") {
          collectText(value, output);
        } else {
          collectText(value, output);
        }
      });
    }
  }

  for (const slideName of slideNames) {
    const xml = await zip.files[slideName].async("string");
    const parsed = parser.parse(xml);
    const textNodes: string[] = [];
    collectText(parsed, textNodes);
    slides.push(normalizeWhitespace(textNodes.join(" ")));
  }

  return slides.join("\n\n");
}

async function extractImageFallbackText(file: File, title: string) {
  return normalizeWhitespace(
    `${title} was uploaded as an image (${file.type || "unknown image type"}). OCR is not enabled yet, so LearnLoop stored the image metadata and generated study scaffolding from the file name.`,
  );
}

async function extractLegacyOfficeFallbackText(file: File, title: string) {
  return normalizeWhitespace(
    `${title} was uploaded in a legacy Office format (${file.type}). LearnLoop stored the file and generated study scaffolding, but deep text extraction for this older format is not enabled in the browser pipeline yet.`,
  );
}

async function extractDocumentText(file: File, title: string) {
  if (file.type === "application/pdf") {
    return extractPdfText(file);
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocxText(file);
  }

  if (file.type === "application/msword") {
    return extractLegacyOfficeFallbackText(file, title);
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return extractPptxText(file);
  }

  if (file.type === "application/vnd.ms-powerpoint") {
    return extractLegacyOfficeFallbackText(file, title);
  }

  if (file.type.startsWith("image/")) {
    return extractImageFallbackText(file, title);
  }

  throw new Error("Unsupported file type.");
}

export async function processDocumentFile(file: File): Promise<ProcessedDocument> {
  if (!SUPPORTED_DOCUMENT_TYPES.includes(file.type as (typeof SUPPORTED_DOCUMENT_TYPES)[number])) {
    throw new Error("Unsupported file type.");
  }

  const title = normalizeTitle(file.name);
  const fileTypeLabel = file.type.startsWith("image/") ? "image" : "document";
  const extractedText = await extractDocumentText(file, title);
  const normalizedText = normalizeWhitespace(extractedText);
  const summary = buildSummaryFromText(normalizedText, title, fileTypeLabel);
  const sections = buildSectionsFromText(normalizedText, title);
  const keywords = extractKeywords(normalizedText, title);
  const concepts = buildConcepts(title, keywords);
  const flashcards = generateFlashcardsFromText(normalizedText, title);

  return {
    title,
    extractedText: normalizedText || summary,
    sections: sections.length > 0 ? sections : buildSectionsFromText(summary, title),
    concepts,
    flashcards,
    summary,
  };
}
