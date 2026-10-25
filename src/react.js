/**
 * A code-block component for React Markdown renderers (react-markdown, Streamdown, …) that draws
 * Mermaid blocks as <wermaid-diagram>. It takes the app's own React instead of importing it, so it
 * loads from a CDN with no build step. Load the element first (auto.js, or defineWermaidElement).
 *
 *   const MermaidBlock = createMermaidBlock(React, { features: ['copy', 'download', 'edit'] });
 *   <Markdown components={{ code: MermaidBlock }}>{answer}</Markdown>
 *
 * Pass `streaming` while the answer is still arriving: the diagram waits until it is removed.
 */
export function createMermaidBlock(React, { features, formats, theme } = {}) {
  return function MermaidBlock({ className, children, streaming }) {
    const text = Array.isArray(children) ? children.join('') : String(children ?? '');
    if (!/(^|\s)language-mermaid(\s|$)/.test(className ?? '')) {
      return React.createElement('code', { className }, children);
    }
    return React.createElement('wermaid-diagram', {
      features: features?.join(' '),
      formats: formats?.join(' '),
      theme,
      streaming: streaming ? '' : undefined,
    }, text);
  };
}
