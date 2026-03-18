import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

type ConceptLike = {
  id?: string;
  label?: string;
};

type SectionLike = {
  id?: string;
  title?: string | null;
  content?: string | null;
};

type DocumentMindMapProps = {
  title: string;
  summary?: string | null;
  concepts?: ConceptLike[];
  sections?: SectionLike[];
};

const LOW_SIGNAL = new Set([
  "overview",
  "section",
  "document",
  "topic",
  "concept",
  "chapter",
  "unit",
  "introduction",
  "summary",
  "part",
  "lesson",
  "module",
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function tokenize(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g)
    ?.filter((token) => !LOW_SIGNAL.has(token)) ?? [];
}

function splitIntoSentences(value: string) {
  return normalizeWhitespace(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isGenericLabel(value: string) {
  const normalized = normalizeWhitespace(value).toLowerCase();

  if (!normalized) {
    return true;
  }

  return (
    /^section\s+\d+/i.test(normalized) ||
    /^chapter\s+\d+/i.test(normalized) ||
    /^unit\s+\d+/i.test(normalized) ||
    /^module\s+\d+/i.test(normalized) ||
    normalized === "overview" ||
    normalized === "introduction" ||
    normalized === "summary"
  );
}

function extractCoreSentence(summary?: string | null, title?: string) {
  const firstSentence = splitIntoSentences(summary ?? "").find(
    (sentence) => sentence.split(/\s+/).length >= 5 && !isGenericLabel(sentence),
  ) ?? "";

  return truncate(firstSentence || title || "Document", 90);
}

function scoreSectionForConcept(section: SectionLike, conceptLabel: string) {
  const sectionTokens = new Set(tokenize(`${section.title ?? ""} ${section.content ?? ""}`));
  const conceptTokens = tokenize(conceptLabel);
  return conceptTokens.filter((token) => sectionTokens.has(token)).length;
}

function extractSectionInsight(section: SectionLike) {
  const sectionTitle = normalizeWhitespace(section.title ?? "");
  const sentences = splitIntoSentences(section.content ?? "");
  const contentSentence =
    sentences.find((sentence) => sentence.split(/\s+/).length >= 6 && !isGenericLabel(sentence)) ??
    sentences.find((sentence) => sentence.split(/\s+/).length >= 4) ??
    "";

  if (contentSentence) {
    return truncate(contentSentence, 88);
  }

  if (sectionTitle && !isGenericLabel(sectionTitle)) {
    return truncate(sectionTitle, 88);
  }

  return "";
}

function deriveBranchLabels(input: DocumentMindMapProps) {
  const conceptLabels = (input.concepts ?? [])
    .map((concept) => truncate(concept.label ?? "", 42))
    .filter(Boolean)
    .filter((label, index, values) => values.indexOf(label) === index)
    .filter((label) => !isGenericLabel(label))
    .filter((label) => label.toLowerCase() !== input.title.toLowerCase())
    .slice(0, 6);

  const sectionInsights = (input.sections ?? [])
    .map((section) => extractSectionInsight(section))
    .filter(Boolean)
    .filter((label, index, values) => values.indexOf(label) === index)
    .slice(0, 8);

  return conceptLabels.length > 0 ? conceptLabels : sectionInsights.slice(0, 6);
}

function buildMindMapGraph(input: DocumentMindMapProps) {
  const rootLabel = extractCoreSentence(input.summary, input.title);
  const branchLabels = deriveBranchLabels(input);

  const visibleSections = (input.sections ?? [])
    .filter((section) => normalizeWhitespace(section.content ?? "").length > 0)
    .slice(0, 6);

  const nodes: Node[] = [
    {
      id: "root",
      position: { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: { label: rootLabel || input.title },
      style: {
        background: "#4f46e5",
        color: "#ffffff",
        border: "1px solid #4338ca",
        borderRadius: 999,
        width: 260,
        padding: 14,
        fontWeight: 600,
        boxShadow: "0 10px 24px rgba(79, 70, 229, 0.18)",
      },
    },
  ];

  const edges: Edge[] = [];
  const branchRadiusX = 320;
  const branchRadiusY = 190;
  const totalBranches = Math.max(1, branchLabels.length);

  branchLabels.forEach((label, index) => {
    const branchId = `branch-${index}`;
    const side = index % 2 === 0 ? 1 : -1;
    const branchLevel = Math.floor(index / 2);
    const verticalOffset = (branchLevel - Math.floor((totalBranches - 1) / 4)) * 140;

    nodes.push({
      id: branchId,
      position: {
        x: side * branchRadiusX,
        y: verticalOffset + (side > 0 ? branchLevel * 12 : branchLevel * -12),
      },
      sourcePosition: side > 0 ? Position.Right : Position.Left,
      targetPosition: side > 0 ? Position.Left : Position.Right,
      data: { label },
      style: {
        background: "#ffffff",
        color: "#111827",
        border: "2px solid #6366f1",
        borderRadius: 18,
        width: 210,
        padding: 12,
        fontWeight: 600,
        boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
      },
    });

    edges.push({
      id: `edge-root-${branchId}`,
      source: "root",
      target: branchId,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
      style: { stroke: "#6366f1", strokeWidth: 2.5 },
    });
  });

  visibleSections.forEach((section, index) => {
    const childLabel = extractSectionInsight(section);

    if (!childLabel) {
      return;
    }

    const bestBranchIndex =
      branchLabels.length > 0
        ? branchLabels
            .map((label, branchIndex) => ({
              branchIndex,
              score: scoreSectionForConcept(section, label),
            }))
            .sort((a, b) => b.score - a.score)[0]?.branchIndex ?? 0
        : 0;

    const parentId = branchLabels.length > 0 ? `branch-${bestBranchIndex}` : "root";
    const siblingIndex = visibleSections
      .slice(0, index)
      .filter((candidate) => {
        const candidateBestBranchIndex =
          branchLabels.length > 0
            ? branchLabels
                .map((label, branchIndex) => ({
                  branchIndex,
                  score: scoreSectionForConcept(candidate, label),
                }))
                .sort((a, b) => b.score - a.score)[0]?.branchIndex ?? 0
            : 0;

        return `branch-${candidateBestBranchIndex}` === parentId;
      }).length;

    const side = bestBranchIndex % 2 === 0 ? 1 : -1;
    const branchLevel = Math.floor(bestBranchIndex / 2);
    const baseY = (branchLevel - Math.floor((totalBranches - 1) / 4)) * 140;
    const branchX = side * branchRadiusX;

    nodes.push({
      id: `section-${index}`,
      position: {
        x: branchX + side * 250,
        y: baseY + siblingIndex * 86 - 40,
      },
      sourcePosition: side > 0 ? Position.Right : Position.Left,
      targetPosition: side > 0 ? Position.Left : Position.Right,
      data: {
        label: childLabel,
      },
      style: {
        background: "#f8fafc",
        color: "#334155",
        border: "1px solid #cbd5e1",
        borderRadius: 16,
        width: 220,
        padding: 10,
        fontSize: 12,
        lineHeight: 1.35,
      },
    });

    edges.push({
      id: `edge-${parentId}-section-${index}`,
      source: parentId,
      target: `section-${index}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
      style: { stroke: "#94a3b8", strokeWidth: 1.5 },
    });
  });

  return { nodes, edges };
}

function FlowCanvas({
  nodes,
  edges,
  interactive,
  instanceKey,
  showMiniMap,
}: {
  nodes: Node[];
  edges: Edge[];
  interactive: boolean;
  instanceKey: string;
  showMiniMap: boolean;
}) {
  return (
    <ReactFlowProvider>
      <ReactFlow
        key={instanceKey}
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.18, includeHiddenNodes: true, duration: 300 }}
        nodesDraggable={interactive}
        nodesConnectable={false}
        elementsSelectable={interactive}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        preventScrolling={false}
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "bezier",
          animated: false,
        }}
      >
        <Background gap={18} size={1} color="#e5e7eb" />
        {showMiniMap ? <MiniMap pannable zoomable /> : null}
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

export function DocumentMindMap(props: DocumentMindMapProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const graph = useMemo(() => buildMindMapGraph(props), [props]);

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wider mb-1">
              Concept Mind Map
            </h2>
            <p className="text-sm text-gray-500">Generated from document summary, concepts, and sections</p>
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Open Mind Map
          </button>
        </div>

        <div className="h-96 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          <FlowCanvas
            instanceKey="workspace-mind-map"
            nodes={graph.nodes}
            edges={graph.edges}
            interactive
            showMiniMap={false}
          />
        </div>
      </div>

      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent className="flex h-[90vh] w-[90vw] max-w-[90vw] flex-col sm:max-w-[90vw] p-6">
          <DialogHeader>
            <DialogTitle>Mind Map</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 rounded-xl border border-gray-200 bg-gray-50">
            <FlowCanvas
              instanceKey="modal-mind-map"
              nodes={graph.nodes}
              edges={graph.edges}
              interactive
              showMiniMap
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
