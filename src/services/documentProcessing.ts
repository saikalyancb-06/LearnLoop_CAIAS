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

type FocusType = "definition" | "process" | "comparison" | "cause" | "fact";

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

function normalizeTextArtifacts(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\uE000-\uF8FF]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/[\u2022\u25AA\u25AB\u25A0\u25A1\u25CF\u25E6\uF0B7]/g, "\n- ")
    .replace(/[‐‑‒–—]/g, "-");
}

function normalizeWhitespace(value: string) {
  return normalizeTextArtifacts(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeForAnalysis(value: string) {
  return normalizeWhitespace(value)
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

function isLikelyCodeLine(line: string) {
  const value = line.trim();

  if (!value) {
    return false;
  }

  return [
    /#include|#define|#pragma/i,
    /\b(int|void|char|float|double|struct|class|return|switch|case|printf|scanf|malloc|free)\b/i,
    /\{/, /\}/,
    /;\s*$/,
    /^\s*\/\//,
    /^\s*\w+\s*\(.*\)\s*\{/,
  ].some((pattern) => pattern.test(value));
}

function isLikelyCodeDocument(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return false;
  }

  const codeLineCount = lines.filter((line) => isLikelyCodeLine(line)).length;
  return codeLineCount >= 6 && codeLineCount / lines.length >= 0.2;
}

function looksLikeHeading(line: string) {
  const value = line.trim();

  if (!value || value.length < 4 || value.length > 120) {
    return false;
  }

  if (/^(chapter|section|unit|module|topic)\b/i.test(value)) {
    return true;
  }

  if (/^\d+(\.\d+)*[)\.]?\s+[A-Z]/.test(value)) {
    return true;
  }

  const lettersOnly = value.replace(/[^A-Za-z]/g, "");
  return Boolean(lettersOnly) && lettersOnly.length >= 4 && lettersOnly === lettersOnly.toUpperCase();
}

function reflowProseText(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  const paragraphs: string[] = [];
  let current = "";

  const flushCurrent = () => {
    const normalized = current.trim();
    if (normalized) {
      paragraphs.push(normalized);
    }
    current = "";
  };

  for (const line of lines) {
    if (!line) {
      flushCurrent();
      continue;
    }

    const isBullet = /^[-*]\s+/.test(line) || /^\d+[)\.]\s+/.test(line);
    const heading = looksLikeHeading(line);

    if (isBullet || heading) {
      flushCurrent();
      paragraphs.push(line);
      continue;
    }

    if (!current) {
      current = line;
      continue;
    }

    if (/-$/.test(current) && !/\s-$/.test(current)) {
      current = `${current.slice(0, -1)}${line}`;
      continue;
    }

    if (/[.!?:]$/.test(current) || current.length > 170) {
      flushCurrent();
      current = line;
      continue;
    }

    current = `${current} ${line}`;
  }

  flushCurrent();

  return normalizeWhitespace(paragraphs.join("\n\n"));
}

function normalizeExtractedText(text: string) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return "";
  }

  if (isLikelyCodeDocument(normalized)) {
    return normalized;
  }

  return reflowProseText(normalized);
}

function splitIntoSentences(text: string) {
  return normalizeForAnalysis(text)
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
  const normalized = normalizeExtractedText(text);

  if (isLikelyCodeDocument(normalized)) {
    const names = [
      ...new Set(
        (normalized.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g) ?? [])
          .map((entry) => entry.replace(/\($/, "").trim().toLowerCase())
          .filter((name) => !["if", "for", "while", "switch", "return", "sizeof", "main"].includes(name)),
      ),
    ].slice(0, 4);

    if (names.length > 0) {
      return `${title} contains source code focused on ${names.join(", ")}. Review the extracted sections to study control flow, data handling, and edge cases.`;
    }

    return `${title} contains source code. Review the extracted sections to understand the logic and behavior step by step.`;
  }

  const sentences = splitIntoSentences(normalized)
    .filter((sentence) => sentence.split(/\s+/).length >= 6)
    .slice(0, 2);

  if (sentences.length > 0) {
    const summary = sentences.join(" ");
    return summary.length > 340 ? `${summary.slice(0, 340).trimEnd()}...` : summary;
  }

  const firstParagraph = normalized.split(/\n{2,}/).find(Boolean) ?? "";

  if (firstParagraph) {
    return firstParagraph.length > 340
      ? `${firstParagraph.slice(0, 340).trimEnd()}...`
      : firstParagraph;
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

  return chunks.map((chunk, index) => ({
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

function detectFocusType(sentence: string): FocusType {
  if (/\b(is|are|refers to|defined as|means)\b/i.test(sentence)) {
    return "definition";
  }

  if (/\b(first|second|third|then|next|finally|step|process|procedure|workflow|algorithm)\b/i.test(sentence)) {
    return "process";
  }

  if (/\b(compared to|versus|vs\.?|difference between|unlike|whereas)\b/i.test(sentence)) {
    return "comparison";
  }

  if (/\b(because|therefore|thus|as a result|leads to|causes?)\b/i.test(sentence)) {
    return "cause";
  }

  return "fact";
}

function extractDefinitionSubject(sentence: string) {
  const match = sentence.match(
    /^([A-Za-z][A-Za-z0-9()\-\s]{2,80}?)\s+(?:is|are|refers to|means|defined as)\b/i,
  );

  return match?.[1]?.trim() ?? null;
}

function selectFocusSentence(chunk: string) {
  const sentences = splitIntoSentences(chunk);

  if (!sentences.length) {
    return null;
  }

  let best:
    | {
        index: number;
        sentence: string;
        type: FocusType;
        score: number;
      }
    | null = null;

  sentences.forEach((sentence, index) => {
    const wordCount = sentence.split(/\s+/).filter(Boolean).length;

    if (wordCount < 4) {
      return;
    }

    const type = detectFocusType(sentence);
    let score = 0;

    if (type !== "fact") {
      score += 4;
    }

    if (wordCount >= 6 && wordCount <= 22) {
      score += 3;
    } else if (wordCount <= 32) {
      score += 1;
    }

    if (/[0-9]/.test(sentence)) {
      score += 1;
    }

    if (/[A-Z]{2,}/.test(sentence)) {
      score += 1;
    }

    if (sentence.includes(":")) {
      score += 1;
    }

    if (!best || score > best.score) {
      best = { index, sentence, type, score };
    }
  });

  if (best) {
    return best;
  }

  return {
    index: 0,
    sentence: sentences[0],
    type: detectFocusType(sentences[0]),
    score: 0,
  };
}

function buildQuestionFromFocus(input: {
  title: string;
  keyword: string;
  focusSentence: string;
  focusType: FocusType;
}) {
  if (input.focusType === "definition") {
    const subject = extractDefinitionSubject(input.focusSentence) ?? input.keyword;
    return `How is ${subject} defined in ${input.title}?`;
  }

  if (input.focusType === "process") {
    return `What steps are described for ${input.keyword} in ${input.title}?`;
  }

  if (input.focusType === "comparison") {
    return `What key difference is described about ${input.keyword} in ${input.title}?`;
  }

  if (input.focusType === "cause") {
    return `Why does ${input.keyword} happen according to ${input.title}?`;
  }

  return `What is the key point about ${input.keyword} in ${input.title}?`;
}

function buildAnswerFromFocus(chunk: string, focusSentenceIndex: number, fallback: string) {
  const sentences = splitIntoSentences(chunk);

  if (!sentences.length) {
    return fallback;
  }

  const primary = sentences[focusSentenceIndex] ?? sentences[0];
  const secondary =
    sentences[focusSentenceIndex + 1] ??
    sentences.find((sentence, index) => index !== focusSentenceIndex);

  return [primary, secondary].filter(Boolean).join(" ") || fallback;
}

function extractPdfPageText(items: Array<unknown>) {
  const positionedItems = items
    .map((item) => {
      if (!item || typeof item !== "object" || !("str" in item)) {
        return null;
      }

      const candidate = item as { str?: unknown; transform?: unknown };
      const text = typeof candidate.str === "string" ? candidate.str.trim() : "";

      if (!text) {
        return null;
      }

      const transform = Array.isArray(candidate.transform) ? candidate.transform : [];

      return {
        text,
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0),
      };
    })
    .filter(Boolean) as Array<{ text: string; x: number; y: number }>;

  if (!positionedItems.length) {
    return "";
  }

  const yTolerance = 2.5;
  const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];

  for (const item of positionedItems) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= yTolerance);

    if (line) {
      line.parts.push({ x: item.x, text: item.text });
      continue;
    }

    lines.push({
      y: item.y,
      parts: [{ x: item.x, text: item.text }],
    });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(" "),
    )
    .join("\n");
}

export function generateFlashcardsFromText(text: string, title: string): GeneratedFlashcard[] {
  const chunks = chunkText(text, 420);
  const keywords = extractKeywords(text, title);
  const seenQuestions = new Set<string>();

  const flashcardsFromChunks = chunks
    .slice(0, 6)
    .map((chunk, index) => {
      const keyword = keywords[index] ?? keywords[0] ?? "the topic";
      const fallbackAnswer = summarizeChunk(
        chunk,
        `${keyword} is one of the main ideas discussed in ${title}. Review the extracted section content to explain it in your own words.`,
      );
      const focus = selectFocusSentence(chunk);

      const question = focus
        ? buildQuestionFromFocus({
            title,
            keyword,
            focusSentence: focus.sentence,
            focusType: focus.type,
          })
        : `What is the key point about ${keyword} in ${title}?`;
      const answer = focus
        ? buildAnswerFromFocus(chunk, focus.index, fallbackAnswer)
        : fallbackAnswer;

      return {
        sortOrder: index,
        question,
        answer,
      };
    })
    .filter((flashcard) => {
      const key = flashcard.question.toLowerCase();

      if (seenQuestions.has(key)) {
        return false;
      }

      seenQuestions.add(key);
      return true;
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
    const pageText = extractPdfPageText(textContent.items as Array<unknown>);
    const fallbackPageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    pages.push(normalizeWhitespace(pageText || fallbackPageText));
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
  const normalizedText = normalizeExtractedText(extractedText);
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
