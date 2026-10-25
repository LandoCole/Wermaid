/**
 * One-line setup: load this file with a script tag and every Mermaid code block on the page becomes
 * a <wermaid-diagram>, including blocks that arrive later (streamed chat answers, for example).
 *
 *   <script type="module" src="https://cdn.jsdelivr.net/gh/…/src/auto.js"
 *           data-features="copy download edit" data-theme="wermaid"></script>
 *
 * Options, all optional, are read from `data-*` attributes on that script tag:
 *   data-features  space-separated features for every diagram (see element.js)
 *   data-formats   space-separated download formats, for example "png svg"
 *   data-theme     the theme every diagram starts with
 *   data-persist   "off" (or "false") to keep nobody's adjustments in the browser
 *   data-mermaid   URL of the Mermaid ES module to use (default: Mermaid 11.16.1 from jsDelivr)
 *   data-watch     "false" to upgrade only the blocks already on the page
 *
 * `ready` resolves once the element is registered and the first pass over the page has started.
 */
import { defineWermaidElement, run } from './element.js';

const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs';

// This module's own <script> tag. Modules have no document.currentScript, so match by URL.
const bare = (url) => String(url).split(/[?#]/)[0];
const self = [...document.querySelectorAll('script[type=module][src]')]
  .find((s) => s.src === import.meta.url) ?? [...document.querySelectorAll('script[type=module][src]')]
  .find((s) => bare(s.src) === bare(import.meta.url));
const data = self?.dataset ?? {};
const list = (value) => (value ?? '').split(/[\s,]+/).filter(Boolean);

export const ready = (async () => {
  const { default: mermaid } = await import(data.mermaid || MERMAID);
  const defaults = {};
  if (data.theme) defaults.theme = data.theme;
  if (data.features) defaults.features = list(data.features);
  if (data.formats) defaults.formats = list(data.formats);
  if (['off', 'false'].includes(data.persist?.toLowerCase())) defaults.persist = false;
  defineWermaidElement(mermaid, { defaults });
  run({ watch: data.watch?.toLowerCase() !== 'false' });
})();
