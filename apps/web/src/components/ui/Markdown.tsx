import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders trusted-ish ClickUp task markdown as formatted prose.
 *
 * react-markdown does NOT render raw HTML embedded in the source (no
 * rehype-raw here), so arbitrary markup in a description can't inject nodes —
 * only the markdown-derived elements below are produced. remark-gfm adds
 * tables, strikethrough, task-list checkboxes, and autolinks. Styling lives in
 * the `.markdown-body` block in index.css so nested elements pick up theme vars.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Force external links to open safely in a new tab.
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
