import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownTextProps = {
  content: string;
  className?: string;
};

const components: Components = {
  h1: ({ node: _node, className, ...props }) => (
    <h1 className={`mb-3 text-2xl font-semibold text-inherit ${className ?? ""}`.trim()} {...props} />
  ),
  h2: ({ node: _node, className, ...props }) => (
    <h2 className={`mb-3 text-xl font-semibold text-inherit ${className ?? ""}`.trim()} {...props} />
  ),
  h3: ({ node: _node, className, ...props }) => (
    <h3 className={`mb-2 text-lg font-semibold text-inherit ${className ?? ""}`.trim()} {...props} />
  ),
  h4: ({ node: _node, className, ...props }) => (
    <h4 className={`mb-2 text-base font-semibold text-inherit ${className ?? ""}`.trim()} {...props} />
  ),
  p: ({ node: _node, className, ...props }) => (
    <p className={`mb-2 last:mb-0 text-inherit ${className ?? ""}`.trim()} {...props} />
  ),
  ul: ({ node: _node, className, ...props }) => (
    <ul className={`mb-3 list-disc space-y-1 pl-5 ${className ?? ""}`.trim()} {...props} />
  ),
  ol: ({ node: _node, className, ...props }) => (
    <ol className={`mb-3 list-decimal space-y-1 pl-5 ${className ?? ""}`.trim()} {...props} />
  ),
  li: ({ node: _node, className, ...props }) => (
    <li className={`text-inherit ${className ?? ""}`.trim()} {...props} />
  ),
  blockquote: ({ node: _node, className, ...props }) => (
    <blockquote
      className={`mb-3 border-l-4 border-slate-300 pl-4 italic text-inherit/80 ${className ?? ""}`.trim()}
      {...props}
    />
  ),
  a: ({ node: _node, className, ...props }) => (
    <a className={`text-indigo-600 underline hover:text-indigo-700 ${className ?? ""}`.trim()} {...props} />
  ),
  table: ({ node: _node, className, ...props }) => (
    <div className="mb-3 overflow-x-auto">
      <table className={`min-w-full border-collapse text-sm ${className ?? ""}`.trim()} {...props} />
    </div>
  ),
  th: ({ node: _node, className, ...props }) => (
    <th
      className={`border border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold ${className ?? ""}`.trim()}
      {...props}
    />
  ),
  td: ({ node: _node, className, ...props }) => (
    <td className={`border border-slate-200 px-3 py-2 align-top ${className ?? ""}`.trim()} {...props} />
  ),
  code: ({ node: _node, className, children, ...props }) => {
    const isBlock = Boolean(className?.includes("language-"));

    if (isBlock) {
      return (
        <code className={`font-mono text-sm ${className ?? ""}`.trim()} {...props}>
          {children}
        </code>
      );
    }

    return (
      <code
        className={`rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.95em] text-slate-800 ${className ?? ""}`.trim()}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ node: _node, className, ...props }) => (
    <pre
      className={`mb-3 overflow-x-auto rounded-md border border-slate-700 bg-slate-950 p-3 text-sm leading-6 text-slate-100 ${className ?? ""}`.trim()}
      {...props}
    />
  ),
  hr: ({ node: _node, className, ...props }) => (
    <hr className={`my-4 border-slate-200 ${className ?? ""}`.trim()} {...props} />
  ),
};

export function MarkdownText({ content, className }: MarkdownTextProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
