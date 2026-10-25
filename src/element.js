/*
 * Embedding Wermaid in a page.
 *
 *   import mermaid from 'mermaid';
 *   import { defineWermaidElement, run } from 'wermaid/element';
 *
 *   defineWermaidElement(mermaid);   // registers <wermaid-diagram>
 *   run();                           // upgrades Mermaid code blocks already on the page
 *
 * <wermaid-diagram> renders Mermaid source with its `%% @layout` block applied.
 * Source comes from the element's text, its `source` property, or a `src` URL.
 *
 * Attributes
 *   theme      a theme name (mermaid, wermaid, pele or one from defineTheme) | none
 *              The diagram's own `%% @theme` wins; this is the starting theme for diagrams that
 *              name none. Then the page default (defineWermaidElement's `defaults.theme`),
 *              then wermaid. none = leave Mermaid's own config alone.
 *   dark       auto | true | false               (default auto: follows prefers-color-scheme)
 *   pannable   present = a canvas viewer: drag to pan, pinch or Ctrl/⌘ + scroll to zoom,
 *              double-click to fit
 *   controls   present = the classic toolbar: zoom and Fit (when pannable) and an Export menu.
 *              Shorthand for features="zoom copy download" formats="png svg"; `features` wins.
 *   features   space-separated list of what is on: copy download edit undo reset themes edges
 *              zoom compare. Default "copy download"; "none" turns every control off.
 *              `zoom` implies pannable. `undo` and `reset` come with `edit` unless listed.
 *   formats    what Download offers: png svg md (default png). One is a button, several a menu.
 *   height     viewer height when pannable (any CSS length, default 420px)
 *   background palette | none | <css colour>     (default none; palette when pannable)
 *   src        URL of a .mmd / text file to load instead of the element's text
 *
 *   themes     space-separated theme names the theme picker offers (registered ones only;
 *              default: every registered theme)
 *
 * Editing (`edit`) works as in the full editor: drag shapes, Alt-drag to pin, resize from corners,
 * drag lines to bend them, arrow keys to nudge (Shift for 10), Delete to reset the selection. The
 * element is focusable then, and keys act only while focus is inside it. Ctrl/⌘ Z undoes,
 * Shift+Ctrl/⌘ Z (or Ctrl/⌘ Y) redoes. A theme or edge-look pick is written into the diagram's
 * block as `%% @theme` / `%% @edges`, so it travels with the source.
 *
 * Events (bubble, composed): `wermaid:render` {detail: {diagram}}, `wermaid:error` {detail: {error}},
 * `wermaid:change` {detail: {source, reason}} once per completed change, where reason is one of
 * drag key reset undo redo pin style theme edges, and source is the full text with its block.
 * Property `rendered` is a promise for the latest render; `diagram` is the latest result;
 * `features` is the resolved list of features (set it with an array or a space-separated string);
 * `editedSource` is the source with the current block (the supplied source plus any edits).
 */

import { createWermaid, parseSource, writeSource, DEFAULT_THEME, clampView, defineTheme, listThemes, getTheme } from './wermaid.js';
import { createEditor, createHistory } from './edit.js';

export { defineTheme, listThemes };

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap';
const MIN_ZOOM = 0.1, MAX_ZOOM = 4;

let engine = null;
let options = { fonts: true, tag: 'wermaid-diagram' };
let queue = Promise.resolve();
let renderCount = 0;
// Page-wide settings from defineWermaidElement's `defaults`: { theme?, features?, formats?, persist? }.
let pageDefaults = {};

/**
 * Register the element. Call once, with the Mermaid instance (v11+) to render with.
 * Options: `tag` (element name), `fonts` (load IBM Plex Mono from Google Fonts for the
 * Wermaid palette; default true), `config` (extra Mermaid config), `defaults` (page-wide
 * settings for every diagram: `theme`, `features`, `formats`, `persist`).
 */
export function defineWermaidElement(mermaid, { tag = 'wermaid-diagram', fonts = true, config = {}, defaults = {} } = {}) {
  // Wermaid renders the blocks itself, so Mermaid must not also auto-render them.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...config });
  engine = createWermaid(mermaid);
  options = { tag, fonts };
  pageDefaults = { ...defaults };
  if (!customElements.get(tag)) customElements.define(tag, class extends WermaidDiagram {});
  return customElements.get(tag);
}

/**
 * Replace Mermaid code blocks with <wermaid-diagram> elements and render them.
 * Per-block options can be given as data attributes on the block (`data-theme`,
 * `data-dark`, `data-pannable`, `data-controls`, `data-features`, `data-formats`, `data-height`, `data-background`);
 * `attributes` sets defaults for every block. Resolves when all have rendered.
 */
export async function run({
  root = document,
  selector = 'pre.mermaid, pre.wermaid, pre > code.language-mermaid, pre > code.language-wermaid',
  attributes = {},
} = {}) {
  if (!engine) throw new Error('Call defineWermaidElement(mermaid) before run().');
  const made = [];
  for (const node of root.querySelectorAll(selector)) {
    const block = node.matches('code') ? node.parentElement : node;
    if (!block?.isConnected || block.dataset.wermaidProcessed) continue;
    block.dataset.wermaidProcessed = 'true';
    const el = document.createElement(options.tag);
    for (const [name, value] of Object.entries(attributes)) setAttr(el, name, value);
    for (const name of ['theme', 'dark', 'pannable', 'controls', 'features', 'formats', 'height', 'background']) {
      const v = block.dataset[name] ?? (node !== block ? node.dataset[name] : undefined);
      if (v !== undefined) setAttr(el, name, v === '' ? true : v);
    }
    el.source = sourceOf(node);
    block.replaceWith(el);
    made.push(el.rendered);
  }
  return Promise.allSettled(made);
}

function setAttr(el, name, value) {
  if (value === false || value == null) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

/* ------------------------------------------------------------------ */

const STYLE = `
  :host { display: block; position: relative; --wermaid-height: 420px;
    --wermaid-ui-bg: #F9F9F7; --wermaid-ui-fg: #1E1F22; --wermaid-ui-muted: #696A6F; --wermaid-ui-line: #BDBDC1; }
  :host([data-dark]) { --wermaid-ui-bg: #151516; --wermaid-ui-fg: #E7E7E3; --wermaid-ui-muted: #9B9CA0; --wermaid-ui-line: #3A3A3F; }
  :host(:focus) { outline: none; }
  :host(:focus-visible) { outline: 2px solid var(--wermaid-ui-fg); outline-offset: 2px; }
  [hidden] { display: none !important; }
  .viewport { position: relative; background: var(--wermaid-bg, transparent); }
  .stage svg { display: block; margin-inline: auto; }
  /* Inline diagrams with editing controls keep a row clear for the toolbar, so it never covers shapes. */
  .viewport.roomy:not(.pan) { padding-top: 40px; }
  .viewport.pan { height: var(--wermaid-height); overflow: hidden; cursor: grab; touch-action: none; }
  .viewport.pan .stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .viewport.pan .stage svg { margin: 0; max-width: none !important; }
  .viewport.panning, .viewport.panning * { cursor: grabbing !important; }
  .toolbar {
    position: absolute; top: 8px; right: 8px; z-index: 2; display: flex; align-items: center; gap: 2px;
    padding: 2px; background: var(--wermaid-ui-bg); color: var(--wermaid-ui-fg); border: 1px solid var(--wermaid-ui-line);
    font: 12px/1.4 "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  }
  .toolbar button { border: 0; background: none; color: inherit; font: inherit; padding: 4px 7px; cursor: pointer; }
  .toolbar button:hover, .toolbar button:focus-visible { background: var(--wermaid-ui-line); outline: none; }
  .toolbar button:focus-visible { box-shadow: inset 0 0 0 2px var(--wermaid-ui-fg); }
  .toolbar select { border: 0; background: none; color: inherit; font: inherit; padding: 4px 2px; cursor: pointer; max-width: 16ch; }
  .toolbar select:hover, .toolbar select:focus-visible { background: var(--wermaid-ui-line); outline: none; }
  .toolbar select:focus-visible { box-shadow: inset 0 0 0 2px var(--wermaid-ui-fg); }
  .toolbar option { background: var(--wermaid-ui-bg); color: var(--wermaid-ui-fg); }
  .toolbar [aria-disabled="true"] { color: var(--wermaid-ui-muted); cursor: default; }
  .toolbar [aria-pressed="true"] { background: var(--wermaid-ui-fg); color: var(--wermaid-ui-bg); }
  .toolbar { opacity: 0; }
  :host(:hover) .toolbar, :host(:focus-visible) .toolbar, .toolbar:focus-within, .toolbar.always { opacity: 1; }
  @media (hover: none) { .toolbar { opacity: 1; } }
  [aria-haspopup]::after { content: " ▾"; }
  .toolbar output { min-width: 4.5ch; text-align: center; color: var(--wermaid-ui-muted); font-variant-numeric: tabular-nums; }
  .menu {
    position: absolute; right: -1px; top: calc(100% + 4px); min-width: 170px; display: grid; padding: 4px 0;
    background: var(--wermaid-ui-bg); border: 1px solid var(--wermaid-ui-line); box-shadow: 0 6px 20px rgba(0,0,0,.08);
  }
  .menu button { text-align: left; padding: 7px 12px; }
  .note { position: absolute; left: 8px; bottom: 8px; z-index: 2; margin: 0; padding: 4px 8px; font: 12px/1.4 ui-monospace, Menlo, monospace;
    background: var(--wermaid-ui-bg); color: var(--wermaid-ui-fg); border: 1px solid var(--wermaid-ui-line); }
  /* Editing: the overlay and hit areas drawn by edit.js. */
  .stage.editable { user-select: none; -webkit-user-select: none; }
  .stage.editable svg { overflow: visible; }
  .stage.editable svg g.node, .stage.editable svg g.edgeLabel,
  .stage.editable svg g.cluster > rect, .stage.editable svg .statediagram-cluster rect { cursor: move; }
  .stage.dragging, .stage.dragging * { cursor: grabbing !important; }
  .stage.editable svg g.node, .stage.editable svg g.edgeLabel, .wm-hit, .wm-overlay .h { touch-action: none; }
  .wm-hit { fill: none; stroke: transparent; stroke-width: 12px; pointer-events: stroke; cursor: crosshair; }
  .wm-overlay .sel { fill: none; stroke: var(--wermaid-ui-fg); stroke-width: 1px; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; pointer-events: none; }
  .wm-overlay .edge-sel { fill: none; stroke: var(--wermaid-ui-fg); stroke-width: 5px; opacity: 0.12; vector-effect: non-scaling-stroke; pointer-events: none; }
  .wm-overlay .h { fill: var(--wermaid-ui-bg); stroke: var(--wermaid-ui-fg); stroke-width: 1px; vector-effect: non-scaling-stroke; }
  .wm-overlay .h.corner { cursor: nwse-resize; }
  .wm-overlay .h.corner.ne, .wm-overlay .h.corner.sw { cursor: nesw-resize; }
  .wm-overlay .h.via { fill: var(--wermaid-ui-fg); cursor: move; }
  .wm-overlay .h.add { cursor: copy; }
  .wm-overlay .pin { fill: var(--wermaid-ui-fg); pointer-events: none; }
  .wm-overlay .pin.hollow { fill: var(--wermaid-ui-bg); stroke: var(--wermaid-ui-fg); stroke-width: 1px; vector-effect: non-scaling-stroke; }
  .error { margin: 0; padding: 12px; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #9a4d07; white-space: pre-wrap; }
`;

const TEMPLATE = `
  <style>${STYLE}</style>
  <div class="viewport" part="viewport">
    <div class="stage" part="stage"></div>
    <div class="toolbar" part="toolbar" role="toolbar" aria-label="Diagram tools" hidden>
      <button type="button" data-act="undo" aria-label="Undo" aria-disabled="true">Undo</button>
      <button type="button" data-act="redo" aria-label="Redo" aria-disabled="true">Redo</button>
      <button type="button" data-act="reset" aria-label="Reset to the diagram as it arrived">Reset</button>
      <button type="button" data-act="compare" aria-pressed="false" aria-label="Show Mermaid’s own layout">Mermaid’s layout</button>
      <select data-act="theme" aria-label="Theme" title="Theme"></select>
      <select data-act="edges" aria-label="Edge look" title="Edge look">
        <option value="">Theme default</option>
        <option value="rounded">Rounded</option>
        <option value="orthogonal">Orthogonal</option>
        <option value="curved">Curved</option>
        <option value="mermaid">Mermaid curves</option>
      </select>
      <span class="zoomers">
        <button type="button" data-act="out" aria-label="Zoom out">−</button>
        <output aria-live="off">100%</output>
        <button type="button" data-act="in" aria-label="Zoom in">+</button>
        <button type="button" data-act="fit" aria-label="Fit diagram to view">Fit</button>
      </span>
      <span class="exporter" style="position: relative">
        <button type="button" data-act="menu" aria-haspopup="menu" aria-expanded="false">Export</button>
        <div class="menu" role="menu" hidden>
          <button type="button" role="menuitem" data-act="copy-png">Copy as PNG</button>
          <button type="button" role="menuitem" data-act="copy-svg">Copy as SVG</button>
          <button type="button" role="menuitem" data-act="save-png">Save as PNG…</button>
          <button type="button" role="menuitem" data-act="save-svg">Save as SVG…</button>
        </div>
      </span>
      <button type="button" class="copy" data-act="copy-png" aria-label="Copy diagram as PNG">Copy</button>
      <button type="button" class="download" data-act="download" aria-label="Download diagram">Download</button>
      <span class="downloads" style="position: relative">
        <button type="button" data-act="dlmenu" aria-haspopup="menu" aria-expanded="false" aria-label="Download diagram as…">Download</button>
        <div class="menu" role="menu" hidden>
          <button type="button" role="menuitem" data-act="download" data-format="png">PNG</button>
          <button type="button" role="menuitem" data-act="download" data-format="svg">SVG</button>
          <button type="button" role="menuitem" data-act="download" data-format="md">Markdown</button>
        </div>
      </span>
    </div>
    <p class="note" part="note" role="status" hidden></p>
  </div>
  <p class="error" part="error" role="alert" hidden></p>
`;

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
let fontLinkAdded = false;

const themeSheets = new Map();

/** Load a theme's fonts and stylesheet before its first render. */
function ensureThemeAssets(name) {
  const theme = getTheme(name);
  if (!theme) return Promise.resolve();
  const faces = theme.fonts || [];
  if (options.fonts && !fontLinkAdded && faces.some((f) => f.includes('IBM Plex Mono')) && !document.querySelector(`link[href="${FONT_HREF}"]`)) {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT_HREF }));
    fontLinkAdded = true;
  }
  const waits = [];
  if (theme.stylesheet) {
    let sheet = themeSheets.get(name);
    if (!sheet || sheet.href !== theme.stylesheet) {
      const link = sheet?.link ?? Object.assign(document.createElement('link'), { rel: 'stylesheet' });
      link.dataset.wermaidTheme = name;
      const loaded = new Promise((resolve) => { link.onload = link.onerror = resolve; });
      link.href = theme.stylesheet;
      if (!link.isConnected) document.head.append(link);
      themeSheets.set(name, (sheet = { href: theme.stylesheet, link, loaded }));
    }
    waits.push(sheet.loaded);
  }
  if (faces.length) waits.push(Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => {}));
  if (!waits.length) return Promise.resolve();
  return Promise.race([Promise.all(waits), new Promise((resolve) => setTimeout(resolve, 2500))]);
}

export class WermaidDiagram extends HTMLElement {
  static observedAttributes = ['theme', 'dark', 'src', 'pannable', 'controls', 'features', 'formats', 'themes', 'height', 'background'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = TEMPLATE;
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this.$ = { viewport: $('.viewport'), stage: $('.stage'), toolbar: $('.toolbar'), zoomers: $('.zoomers'),
      zoomOut: $('output'), exporter: $('.exporter'), copy: $('.copy'), download: $('.download'), downloads: $('.downloads'),
      note: $('.note'), error: $('.error'), undo: $('[data-act="undo"]'), redo: $('[data-act="redo"]'),
      reset: $('[data-act="reset"]'), compare: $('[data-act="compare"]'), themePick: $('[data-act="theme"]'),
      edgePick: $('[data-act="edges"]') };
    this._source = null;
    this._diagram = null;
    // Source bookkeeping: what the app supplied (reset goes back to it) and what is shown now
    // (that plus any edits). A new source bumps _wanted; the next render loads it.
    this._supplied = null;
    this._current = null;
    this._wanted = 1;
    this._loaded = 0;
    this._renderKey = null;
    this._history = createHistory();
    this._editor = null;
    this._editorFor = null;
    this._stock = false;
    this._view = { x: 0, y: 0, zoom: 1 };
    this._lastVB = null;
    this._rendered = Promise.resolve(null);
    this._pending = false;
    this._onDark = () => { if ((this.getAttribute('dark') ?? 'auto') === 'auto') this._schedule(); };
    this._wire();
  }

  /** The Mermaid source (with or without a layout block). */
  get source() { return this._source ?? sourceOf(this); }
  set source(text) { this._source = String(text); this._newSource(); }
  /** The source with its current layout block: the supplied source plus any edits. */
  get editedSource() { return this._current ?? dedent(this.source); }
  /** The latest render result (see createWermaid().render), or null. */
  get diagram() { return this._diagram; }
  /** Promise for the latest render; resolves with the diagram, rejects on error. */
  get rendered() { return this._rendered; }

  /**
   * The features that are on, as a list of names. Resolved from the `features` attribute
   * ("none" = nothing), else the `controls` shorthand, else the page default, else copy and download.
   * Set it with an array or a space-separated string; it is reflected to the attribute.
   */
  get features() {
    const attr = this.getAttribute('features');
    let list = attr !== null ? names(attr)
      : this.hasAttribute('controls') ? ['zoom', 'copy', 'download']
        : pageDefaults.features != null ? names(pageDefaults.features) : ['copy', 'download'];
    list = list.filter((n, i) => FEATURES.includes(n) && list.indexOf(n) === i);
    // Editing brings Undo and Reset along, unless the list says which of them it wants.
    if (list.includes('edit') && !list.includes('undo') && !list.includes('reset')) list.push('undo', 'reset');
    return list;
  }
  set features(value) {
    const list = names(value);
    this.setAttribute('features', list.length ? list.join(' ') : 'none');
  }

  connectedCallback() {
    darkQuery?.addEventListener('change', this._onDark);
    if (!this._observer) {
      // Inline source edited after the fact (by a framework, say) re-renders.
      this._observer = new MutationObserver(() => { if (this._source === null) this._newSource(); });
    }
    this._observer.observe(this, { childList: true, characterData: true, subtree: true });
    if (!this._sizeObserver) {
      this._sizeObserver = new ResizeObserver(() => {
        if (!this._pannable()) return;
        if (this._autoFit) this._fit(); else this._sizeSvg();
      });
    }
    this._sizeObserver.observe(this.$.viewport);
    this._applyChrome();
    this._schedule();
  }

  disconnectedCallback() {
    darkQuery?.removeEventListener('change', this._onDark);
    this._observer?.disconnect();
    this._visibleObserver?.disconnect();
    this._visibleObserver = null;
    this._sizeObserver?.disconnect();
  }

  attributeChangedCallback(name, oldValue, value) {
    if (oldValue === value) return;
    if (name === 'src') this._newSource();
    else if (name === 'theme' || name === 'dark') this._schedule();
    else this._applyChrome();
  }

  /** A new source from the app: the next render loads it, dropping edits, history and selection. */
  _newSource() {
    this._wanted++;
    this._editor?.select(null);
    this._schedule();
  }

  /** Re-render now, re-reading the source unless it has been edited (edits are kept). */
  refresh() {
    if (this._current === this._supplied) this._wanted++;
    this._schedule();
    return this._rendered;
  }
  /** Scale the drawing to the viewer and centre it (pannable viewers). */
  fit() { this._fit(); }

  /** The classic `controls` toolbar: zoom and an Export menu, always shown. */
  _legacy() { return this.hasAttribute('controls') && !this.hasAttribute('features'); }
  /** A canvas viewer: the `pannable` attribute, or the zoom feature. */
  _pannable() { return this.hasAttribute('pannable') || (!this._legacy() && this.features.includes('zoom')); }
  /** What Download offers: the attribute, the `controls` shorthand, the page default, else PNG. */
  _formats() {
    const attr = this.getAttribute('formats');
    const list = names(attr !== null ? attr
      : this.hasAttribute('controls') && !this.hasAttribute('features') ? 'png svg'
        : pageDefaults.formats ?? 'png').filter((f, i, all) => FORMATS.includes(f) && all.indexOf(f) === i);
    return list.length ? list : ['png'];
  }

  /* ---------------- rendering ---------------- */

  _schedule() {
    if (!this.isConnected) return;
    if (!this._settle) {
      // One promise per pending render; errors also go to the event and the error panel.
      this._rendered = new Promise((resolve, reject) => { this._settle = { resolve, reject }; });
      this._rendered.catch(() => {});
    }
    if (this._pending) return;
    // Mermaid measures text as it lays out, so wait until the element is actually displayed
    // (it may start inside a closed <details>, a hidden tab, or display: none).
    if (!this.getClientRects().length) { this._whenVisible(); return; }
    this._pending = true;
    queueMicrotask(() => {
      this._pending = false;
      const settle = this._settle;
      this._settle = null;
      queue = queue.then(() => this._render()).then(settle.resolve, settle.reject);
    });
  }

  _whenVisible() {
    if (this._visibleObserver) return;
    this._visibleObserver = new ResizeObserver(() => {
      if (!this.getClientRects().length) return;
      this._visibleObserver.disconnect();
      this._visibleObserver = null;
      this._schedule();
    });
    this._visibleObserver.observe(this);
  }

  async _render() {
    if (!engine) throw new Error('Call defineWermaidElement(mermaid) before using <wermaid-diagram>.');
    const { stage, error } = this.$;
    try {
      let text;
      const wanted = this._wanted;
      if (this._loaded !== wanted) {
        // A new source from the app: load it, and start over from it.
        text = this.source;
        const src = this.getAttribute('src');
        if (src && this._source === null) {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`Couldn't load ${src} (${res.status})`);
          text = await res.text();
        }
        text = dedent(text);
        this._loaded = wanted;
        this._supplied = this._current = text;
        this._history.clear();
        this._editor?.select(null);
      } else {
        text = this._current;
      }
      if (!text.trim()) {
        stage.replaceChildren();
        this._diagram = this._renderKey = this._editorFor = null;
        this._editor?.attach(null);
        return null;
      }
      const block = parseSource(text);
      const { used, fallbacks, none } = this._themeFor(block);
      const dark = this._isDark();
      this.toggleAttribute('data-dark', dark);
      if (used) await ensureThemeAssets(used);
      const diagram = await engine.render(stage, text, { id: `wermaid-${++renderCount}`, theme: none ? null : undefined, defaultTheme: fallbacks, dark });
      this._diagram = diagram;
      this._renderKey = renderKey(block, used, dark);
      error.hidden = true;
      this._lastVB = null;
      this._syncEditor();
      if (this._stock && !this._editor) diagram.showStock();
      this._applyChrome();
      if (this._pannable()) this._fit();
      this.dispatchEvent(new CustomEvent('wermaid:render', { detail: { diagram }, bubbles: true, composed: true }));
      return diagram;
    } catch (err) {
      error.textContent = `Couldn't render this diagram.\n${(err?.message || String(err)).split('\n').slice(0, 3).join('\n')}`;
      error.hidden = false;
      this.dispatchEvent(new CustomEvent('wermaid:error', { detail: { error: err }, bubbles: true, composed: true }));
      throw err;
    }
  }

  /**
   * Which theme a parsed source renders with: the block's @theme, then the attribute, then the
   * page default, then wermaid. The attribute and page default are only fallbacks, so a name the
   * page hasn't defined falls through to the next level (with a warning from the engine).
   */
  _themeFor(block) {
    const attr = this.getAttribute('theme');
    const none = attr === 'none';
    const fallbacks = none ? [] : [attr, pageDefaults.theme, DEFAULT_THEME].filter(Boolean);
    const used = [block.overrides.settings.theme, ...fallbacks].find((n) => getTheme(n)) ?? null;
    return { used, fallbacks, none };
  }

  _isDark() {
    const darkAttr = this.getAttribute('dark') ?? 'auto';
    return darkAttr === 'auto' ? !!darkQuery?.matches : darkAttr !== 'false';
  }

  /* ---------------- editing, history and pickers ---------------- */

  /** Create the editor when `edit` is on (and remove it when off); attach it to the drawing. */
  _syncEditor() {
    const want = this.features.includes('edit');
    if (want && !this._editor) {
      const { stage } = this.$;
      this._editor = createEditor(stage, {
        // Drags snap to the 8-unit grid; arrow keys move by 1 (Shift: 10).
        snap: () => stage.classList.contains('dragging'),
        scale: () => this._diagram?.svg?.getScreenCTM()?.a || 1,
        onPreview: () => this._sizeDrawing(),
        onCommit: (overrides, reason) => {
          this._sizeDrawing();
          if (this._inSync()) this._record(writeSource(this._current, overrides, this._diagram.scene), reason);
        },
      });
      this._editor.setStock(this._stock);
      this._editorFor = null;
    } else if (!want && this._editor) {
      this._editor.destroy();
      this._editor = null;
    }
    if (this._editor && this._diagram && this._editorFor !== this._diagram) {
      this._editor.attach(this._diagram, this._diagram.overrides);
      this._editorFor = this._diagram;
    }
    this.$.stage.classList.toggle('editable', !!(this._editor && this._diagram?.supported));
    // Focusable while editing, so arrow keys and Ctrl/⌘ Z reach it (an author's tabindex is kept).
    if (want && !this.hasAttribute('tabindex')) { this.setAttribute('tabindex', '0'); this._ownTabindex = true; }
    else if (!want && this._ownTabindex) { this.removeAttribute('tabindex'); this._ownTabindex = false; }
  }

  /**
   * The drawing shows the current text (not a stale one while a re-render is pending or after a
   * failed one), so a change made on it can be written back into that text.
   */
  _inSync() {
    if (!this._diagram || this._current === null) return false;
    const block = parseSource(this._current);
    return this._renderKey === renderKey(block, this._themeFor(block).used, this._isDark());
  }

  /** The overrides being shown (the editor's, which are the drawing's own once attached). */
  _overrides() { return this._editor?.overrides ?? this._diagram?.overrides; }

  /** Record a completed change: the text before it goes on the undo stack, then tell the app. */
  _record(text, reason, { show = false } = {}) {
    if (text === this._current) return;
    this._history.push(this._current);
    if (show) this._show(text); else this._current = text;
    this._emitChange(reason);
  }

  /** Show a source text: re-apply its block to the current drawing, or re-render if it must. */
  _show(text) {
    this._current = text;
    const d = this._diagram;
    if (this._inSync()) {
      const { overrides } = parseSource(text);
      if (this._editor) { this._editor.attach(d, overrides); this._editorFor = d; }
      else { d.setOverrides(overrides); if (this._stock) d.showStock(); }
      this._sizeDrawing();
    } else {
      this._schedule();
    }
    this._updateEditChrome();
  }

  _emitChange(reason) {
    this._updateEditChrome();
    this.dispatchEvent(new CustomEvent('wermaid:change', { detail: { source: this._current, reason }, bubbles: true, composed: true }));
  }

  _undo() {
    const text = this._history.undo(this._current);
    if (text == null) return;
    this._show(text);
    this._emitChange('undo');
  }

  _redo() {
    const text = this._history.redo(this._current);
    if (text == null) return;
    this._show(text);
    this._emitChange('redo');
  }

  /** Back to the source as the app supplied it; the history starts over. */
  _reset() {
    if (this._supplied === null) return;
    this._history.clear();
    this._editor?.select(null);
    if (this._current === this._supplied) { this._updateEditChrome(); return; }
    this._show(this._supplied);
    this._emitChange('reset');
  }

  /** Mermaid's own drawing (overrides kept, not drawn), or back to the edited one. */
  _setStock(on) {
    this._stock = on;
    const d = this._diagram;
    if (this._editor) this._editor.setStock(on);
    else if (d) { if (on) d.showStock(); else d.setOverrides(d.overrides); }
    this._sizeDrawing();
    this._updateEditChrome();
  }

  /** A theme pick is written into the block as `%% @theme`, so it beats the attribute. */
  _pickTheme(name) {
    const d = this._diagram;
    if (!this._inSync() || !getTheme(name)) { this._updateEditChrome(); return; }
    const overrides = this._overrides();
    overrides.settings.theme = name;
    this._record(writeSource(this._current, overrides, d.scene), 'theme', { show: true });
  }

  /** An edge-look pick is written as `%% @edges`; "" (theme default) removes it. */
  _pickEdges(style) {
    const d = this._diagram;
    if (!this._inSync()) { this._updateEditChrome(); return; }
    const overrides = this._overrides();
    if (style) overrides.settings.edges = { ...overrides.settings.edges, style };
    else delete overrides.settings.edges;
    if (this._editor) this._editor.apply();
    else if (!this._stock) d.setOverrides(overrides);
    this._sizeDrawing();
    this._record(writeSource(this._current, overrides, d.scene), 'edges');
  }

  /** Undo/Redo availability, the pickers' values and the compare toggle. */
  _updateEditChrome() {
    const { undo, redo, compare, themePick, edgePick } = this.$;
    undo.setAttribute('aria-disabled', String(!this._history.canUndo));
    redo.setAttribute('aria-disabled', String(!this._history.canRedo));
    compare.setAttribute('aria-pressed', String(this._stock));
    // The theme the shown text renders with (already the new one while a pick re-renders).
    themePick.value = (this._current !== null ? this._themeFor(parseSource(this._current)).used : this._diagram?.theme) ?? '';
    edgePick.value = this._overrides()?.settings?.edges?.style ?? '';
  }

  /** The theme picker offers the `themes` attribute's names (registered ones), else every theme. */
  _fillThemes() {
    const { themePick } = this.$;
    const attr = this.getAttribute('themes');
    const list = (attr !== null ? names(attr) : listThemes().map((t) => t.name)).filter((n, i, all) => getTheme(n) && all.indexOf(n) === i);
    const key = list.join(' ');
    if (themePick.dataset.list === key) return;
    themePick.dataset.list = key;
    themePick.replaceChildren(...list.map((n) => new Option(getTheme(n).label || n, n)));
  }

  /** Keep the drawing's size in step with its frame after the overrides change. */
  _sizeDrawing() {
    const svg = this._diagram?.svg;
    if (!svg) return;
    if (this._pannable()) this._sizeSvg();
    else svg.style.maxWidth = `${svg.viewBox.baseVal.width}px`;
  }

  /** Redraw the selection handles at the current zoom. */
  _redrawOverlay() { if (this._editor) this._editor.select(this._editor.selection); }

  /* ---------------- chrome: toolbar, background, size ---------------- */

  _applyChrome() {
    const { toolbar, zoomers, exporter, copy, download, downloads, viewport, undo, redo, reset, compare, themePick, edgePick } = this.$;
    const pannable = this._pannable();
    const legacy = this._legacy();
    const features = this.features;
    const formats = this._formats();
    this._syncEditor();
    undo.hidden = redo.hidden = !features.includes('undo');
    reset.hidden = !features.includes('reset');
    compare.hidden = !features.includes('compare');
    themePick.hidden = !features.includes('themes');
    edgePick.hidden = !features.includes('edges');
    if (this._stock && compare.hidden) this._setStock(false);
    this._fillThemes();
    this._updateEditChrome();
    viewport.classList.toggle('pan', pannable);
    zoomers.hidden = !(pannable && features.includes('zoom'));
    exporter.hidden = !legacy;
    copy.hidden = legacy || !features.includes('copy');
    const saving = !legacy && features.includes('download');
    download.hidden = !saving || formats.length > 1;
    downloads.hidden = !saving || formats.length < 2;
    download.dataset.format = formats[0];
    download.setAttribute('aria-label', `Download diagram as ${formats[0].toUpperCase()}`);
    for (const item of downloads.querySelectorAll('[data-format]')) item.hidden = !formats.includes(item.dataset.format);
    // The classic toolbar stays on screen; the new one shows on hover and focus.
    toolbar.classList.toggle('always', legacy);
    toolbar.hidden = [undo, redo, reset, compare, themePick, edgePick, zoomers, exporter, copy, download, downloads].every((n) => n.hidden);
    viewport.classList.toggle('roomy', [undo, redo, reset, compare, themePick, edgePick].some((n) => !n.hidden));
    if (toolbar.hidden) this._menu(null);
    const h = this.getAttribute('height');
    if (h) this.style.setProperty('--wermaid-height', /^\d+(\.\d+)?$/.test(h) ? `${h}px` : h);
    else this.style.removeProperty('--wermaid-height');
    const bgAttr = this.getAttribute('background') ?? (pannable ? 'palette' : 'none');
    const bg = bgAttr === 'none' ? 'transparent' : bgAttr === 'palette' ? (this._diagram?.background || 'transparent') : bgAttr;
    viewport.style.setProperty('--wermaid-bg', bg);
    const svg = this._diagram?.svg;
    if (!svg) return;
    if (pannable) {
      this._sizeSvg();
    } else {
      // Inline: Mermaid's own responsive sizing.
      svg.removeAttribute('height');
      svg.setAttribute('width', '100%');
      svg.style.maxWidth = `${svg.viewBox.baseVal.width}px`;
      this.$.stage.style.transform = '';
    }
  }

  _sizeSvg() {
    const svg = this._diagram?.svg;
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const v = this._view;
    if (this._lastVB && (vb.x !== this._lastVB.x || vb.y !== this._lastVB.y)) {
      v.x += (vb.x - this._lastVB.x) * v.zoom;
      v.y += (vb.y - this._lastVB.y) * v.zoom;
    }
    this._lastVB = { x: vb.x, y: vb.y };
    if (this._pannable()) {
      // The canvas ends a little past the diagram: panning can't lose it off screen.
      const W = this.$.viewport.clientWidth, H = this.$.viewport.clientHeight;
      const top = this.$.toolbar.hidden ? 16 : 44;
      Object.assign(v, clampView(v, { width: vb.width * v.zoom, height: vb.height * v.zoom }, { width: W, height: H }, { inset: { top } }));
    }
    svg.style.maxWidth = 'none';
    svg.setAttribute('width', String(Math.round(vb.width * v.zoom)));
    svg.setAttribute('height', String(Math.round(vb.height * v.zoom)));
    this.$.stage.style.transform = `translate(${Math.round(v.x * 10) / 10}px, ${Math.round(v.y * 10) / 10}px)`;
    this.$.zoomOut.textContent = `${Math.round(v.zoom * 100)}%`;
  }

  _fit() {
    const svg = this._diagram?.svg;
    if (!svg || !this._pannable()) return;
    const vb = svg.viewBox.baseVal;
    const W = this.$.viewport.clientWidth, H = this.$.viewport.clientHeight;
    const pad = 24, top = this.$.toolbar.hidden ? pad : 44;
    const z = Math.max(MIN_ZOOM, Math.min((W - 2 * pad) / vb.width, (H - top - pad) / vb.height, 1.5));
    if (!W || !H) { this._autoFit = true; return; }
    this._view = { zoom: z, x: (W - vb.width * z) / 2, y: top + (H - top - pad - vb.height * z) / 2 };
    this._autoFit = true; // keep fitting on resize until the viewer pans or zooms
    this._lastVB = { x: vb.x, y: vb.y };
    this._sizeSvg();
    this._redrawOverlay();
  }

  _zoomAt(z, ax, ay) {
    this._autoFit = false;
    const v = this._view;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    v.x = ax - (ax - v.x) * (next / v.zoom);
    v.y = ay - (ay - v.y) * (next / v.zoom);
    v.zoom = next;
    this._sizeSvg();
    this._redrawOverlay();
  }

  /* ---------------- interaction ---------------- */

  _wire() {
    const { viewport, toolbar } = this.$;
    const pannable = () => this._pannable() && this._diagram;

    toolbar.addEventListener('click', (ev) => {
      const button = ev.target.closest('button[data-act]');
      if (!button) return;
      const act = button.dataset.act;
      const W = viewport.clientWidth, H = viewport.clientHeight;
      if (act === 'in') this._zoomAt(this._view.zoom * 1.25, W / 2, H / 2);
      else if (act === 'out') this._zoomAt(this._view.zoom / 1.25, W / 2, H / 2);
      else if (act === 'fit') this._fit();
      else if (act === 'undo') this._undo();
      else if (act === 'redo') this._redo();
      else if (act === 'reset') this._reset();
      else if (act === 'compare') this._setStock(!this._stock);
      else if (act === 'menu' || act === 'dlmenu') {
        const menu = button.nextElementSibling;
        this._menu(menu.hidden ? menu : null);
      } else {
        this._menu(null);
        this._export(act === 'download' ? `save-${button.dataset.format}` : act);
      }
    });
    toolbar.addEventListener('change', (ev) => {
      const act = ev.target.dataset.act;
      if (act === 'theme') this._pickTheme(ev.target.value);
      else if (act === 'edges') this._pickEdges(ev.target.value);
    });
    toolbar.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    toolbar.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this._openMenu) { const btn = this._openMenu.previousElementSibling; this._menu(null); btn.focus(); }
    });
    this.addEventListener('focusout', (ev) => {
      if (this._openMenu && !this.shadowRoot.contains(ev.relatedTarget)) this._menu(null);
    });

    // Keys reach the element only while focus is inside it. Pickers and menus keep their own keys.
    this.addEventListener('keydown', (ev) => {
      if (ev.composedPath()[0]?.closest?.('select, input, textarea, .menu')) return;
      const mod = ev.ctrlKey || ev.metaKey;
      const key = ev.key.toLowerCase();
      if (mod && !ev.altKey && (key === 'z' || key === 'y')) {
        if (!this.features.includes('undo')) return;
        ev.preventDefault();
        if (key === 'y' || ev.shiftKey) this._redo(); else this._undo();
        return;
      }
      if (!mod && !ev.altKey) this._editor?.handleKey(ev);
    });

    // Editing: a press on a shape is the editor's (it calls preventDefault); it also focuses the
    // element so keys apply here. A plain click on the background clears the selection.
    let press = null;
    viewport.addEventListener('pointerdown', (ev) => {
      if (!this._editor) return;
      this.focus({ preventScroll: true });
      press = !ev.defaultPrevented && ev.button === 0 ? { id: ev.pointerId, x: ev.clientX, y: ev.clientY } : null;
    });
    viewport.addEventListener('pointerup', (ev) => {
      if (press && ev.pointerId === press.id && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < 3) this._editor?.select(null);
      press = null;
    });

    // Ctrl/⌘ + scroll or a trackpad pinch zooms at the pointer; plain scrolling scrolls the page.
    viewport.addEventListener('wheel', (ev) => {
      if (!pannable() || !(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const r = viewport.getBoundingClientRect();
      const unit = ev.deltaMode === 1 ? 16 : 1;
      this._zoomAt(this._view.zoom * Math.exp(-ev.deltaY * unit * 0.01), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    // Double-click fits, except on what the editor handles (a double press on a bend removes it).
    const editable = '.toolbar, g.node, g.cluster, g.edgeLabel, .wm-overlay, .wm-hit';
    viewport.addEventListener('dblclick', (ev) => { if (pannable() && !ev.target.closest(this._editor ? editable : '.toolbar')) this._fit(); });

    const touches = new Map();
    let pan = null, pinch = null;
    viewport.addEventListener('pointerdown', (ev) => {
      // A press the editor took (on a shape or handle) isn't a pan.
      if (!pannable() || ev.defaultPrevented || (ev.button !== 0 && ev.button !== 1)) return;
      if (ev.pointerType === 'touch') {
        touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          const r = viewport.getBoundingClientRect();
          pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, view: { ...this._view } };
          pan = null;
          viewport.setPointerCapture(ev.pointerId);
          return;
        }
      }
      pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, vx: this._view.x, vy: this._view.y, moved: false };
      viewport.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    viewport.addEventListener('pointermove', (ev) => {
      if (touches.has(ev.pointerId)) {
        touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pinch && touches.size === 2) {
          const [a, b] = [...touches.values()];
          const r = viewport.getBoundingClientRect();
          const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
          const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.view.zoom * Math.hypot(b.x - a.x, b.y - a.y) / pinch.dist));
          this._autoFit = false;
          this._view = { zoom: z, x: mid.x - (pinch.mid.x - pinch.view.x) * (z / pinch.view.zoom), y: mid.y - (pinch.mid.y - pinch.view.y) * (z / pinch.view.zoom) };
          this._sizeSvg();
          this._redrawOverlay();
          return;
        }
      }
      if (!pan || ev.pointerId !== pan.id) return;
      const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < 3) return;
      pan.moved = true;
      this._autoFit = false;
      viewport.classList.add('panning');
      this._view.x = pan.vx + dx;
      this._view.y = pan.vy + dy;
      this._sizeSvg();
    });
    const end = (ev) => {
      if (touches.delete(ev.pointerId) && touches.size < 2) pinch = null;
      if (pan && ev.pointerId === pan.id) { pan = null; viewport.classList.remove('panning'); }
    };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
  }

  /** Open the given menu (closing any other), or close the open one with null. */
  _menu(menu) {
    for (const m of this.shadowRoot.querySelectorAll('.menu')) {
      m.hidden = m !== menu;
      m.previousElementSibling.setAttribute('aria-expanded', String(m === menu));
    }
    this._openMenu = menu;
    menu?.querySelector('button:not([hidden])')?.focus();
  }

  _note(text) {
    const { note } = this.$;
    note.textContent = text;
    note.hidden = false;
    clearTimeout(this._noteTimer);
    this._noteTimer = setTimeout(() => { note.hidden = true; }, 1800);
  }

  async _export(kind) {
    const d = this._diagram;
    if (!d) return;
    const name = (this.getAttribute('name') || d.overrides?.settings?.title || 'my-wermaid').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram';
    const background = d.background || getComputedStyle(this).backgroundColor || '#ffffff';
    if (kind === 'copy-png') {
      // Copying an image needs the async clipboard; where it is missing or refused, say so.
      try {
        if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('no image clipboard');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': d.toPNG({ background }) })]);
        this._note('PNG copied');
      } catch {
        this._note("Copying isn't available here");
      }
      return;
    }
    try {
      if (kind === 'copy-svg') {
        await navigator.clipboard.writeText(d.toSVG());
        this._note('SVG copied');
      } else if (kind === 'save-md') {
        await this._save(`${name}.md`, new Blob([`\`\`\`mermaid\n${this.editedSource.trim()}\n\`\`\`\n`], { type: 'text/markdown' }));
      } else if (kind === 'save-png') {
        await this._save(`${name}.png`, await d.toPNG({ background }));
      } else if (kind === 'save-svg') {
        await this._save(`${name}.svg`, new Blob([d.toSVG()], { type: 'image/svg+xml' }));
      }
    } catch (err) {
      this._note(err?.name === 'SecurityError' ? 'This browser won’t export these labels as an image' : 'Export was blocked here');
    }
  }

  /** Save through Claude's viewer when the page runs inside it, else as a normal download. */
  async _save(filename, data) {
    const downloads = window.claude?.use ? await window.claude.use('downloads') : null;
    if (downloads) {
      try { await downloads.save({ filename, data }); this._note(`Saved ${filename}`); }
      catch (err) { if (err?.code !== 'declined') this._note('Saving isn’t available here'); }
      return;
    }
    if (window.top !== window && window.claude) { this._note('Saving isn’t available here'); return; }
    const url = URL.createObjectURL(data);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this._note(`Saved ${filename}`);
  }
}

const FEATURES = ['copy', 'download', 'edit', 'undo', 'reset', 'themes', 'edges', 'zoom', 'compare'];
const FORMATS = ['png', 'svg', 'md'];

/** What a render depends on besides the block: the body, the theme it resolves to, dark or light. */
function renderKey(block, theme, dark) {
  return `${block.body}\u0000${theme}\u0000${dark}`;
}

/** A list given as an array or as space-separated words; "none" is the empty list. */
function names(value) {
  const list = Array.isArray(value) ? value.map(String) : String(value).split(/[\s,]+/);
  const words = list.map((w) => w.trim().toLowerCase()).filter(Boolean);
  return words.length === 1 && words[0] === 'none' ? [] : words;
}

/**
 * Diagram text written in HTML, read the way Mermaid reads it: from the markup, so labels that use
 * `<br/>` keep their line breaks (the parser turns them into elements, which textContent drops),
 * with entities decoded. A detached <textarea> decodes as text, so nothing in it is parsed or run.
 */
function sourceOf(node) {
  const decoder = document.createElement('textarea');
  decoder.innerHTML = node.innerHTML.replace(/<br\s*\/?>/gi, '<br/>').replace(/<\/br>/gi, '');
  return decoder.value;
}

/** Strip the common leading indentation, so source can be indented inside HTML. */
function dedent(text) {
  const lines = String(text).replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

export default { defineWermaidElement, run, WermaidDiagram };
