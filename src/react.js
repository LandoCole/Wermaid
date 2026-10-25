/**
 * A code-block component for React Markdown renderers (react-markdown, Streamdown, …) that draws
 * Mermaid blocks as <wermaid-diagram>. It takes the app's own React instead of importing it, so it
 * loads from a CDN with no build step. Load the element first (auto.js, or defineWermaidElement).
 *
 *   const Streaming = React.createContext(false);
 *   const MermaidBlock = createMermaidBlock(React, { features: ['copy', 'download', 'edit'], streaming: Streaming });
 *   <Streaming.Provider value={stillArriving}>
 *     <Markdown components={{ code: MermaidBlock }}>{answer}</Markdown>
 *   </Streaming.Provider>
 *
 * While the answer is still arriving the diagram waits, drawing nothing and showing no error.
 * Markdown renderers don't pass a `streaming` prop to their code component, so `streaming` is an
 * option: a React context (read with useContext) or a boolean. A `streaming` prop given to the
 * component directly still wins.
 */
export function createMermaidBlock(React, { features, formats, theme, streaming: streamingOption } = {}) {
  const context = isContext(streamingOption) ? streamingOption : null;
  return function MermaidBlock({ className, children, streaming }) {
    // Read on every render, before any early return: hooks must run in the same order each time.
    const fromOption = context ? React.useContext(context) : streamingOption;
    const still = streaming !== undefined ? streaming : fromOption;
    const text = Array.isArray(children) ? children.join('') : String(children ?? '');
    if (!/(^|\s)language-mermaid(\s|$)/.test(className ?? '')) {
      return React.createElement('code', { className }, children);
    }
    return React.createElement('wermaid-diagram', {
      features: features?.join(' '),
      formats: formats?.join(' '),
      theme,
      streaming: still ? '' : undefined,
    }, text);
  };
}

/** A React context object (React 18's has a Provider; 19's is its own provider, and keeps one). */
const isContext = (value) => value != null && typeof value === 'object' && ('$$typeof' in value || 'Provider' in value);
