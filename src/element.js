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
 *   theme      mermaid | wermaid | pele | none   (default: the block's @theme, else wermaid;
 *              none = leave Mermaid's own config alone)
 *   dark       auto | true | false               (default auto: follows prefers-color-scheme)
 *   pannable   present = a canvas viewer: drag to pan, pinch or Ctrl/⌘ + scroll to zoom,
 *              double-click to fit
 *   controls   present = a small toolbar: zoom and Fit (when pannable) and Export
 *   height     viewer height when pannable (any CSS length, default 420px)
 *   background palette | none | <css colour>     (default none; palette when pannable)
 *   src        URL of a .mmd / text file to load instead of the element's text
 *
 * Events (bubble, composed): `wermaid:render` {detail: {diagram}}, `wermaid:error` {detail: {error}}.
 * Property `rendered` is a promise for the latest render; `diagram` is the latest result.
 */

import { createWermaid, parseSource, THEMES, DEFAULT_THEME, clampView } from './wermaid.js';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap';
const MIN_ZOOM = 0.1, MAX_ZOOM = 4;

let engine = null;
let options = { fonts: true, tag: 'wermaid-diagram' };
let queue = Promise.resolve();
let renderCount = 0;

/**
 * Register the element. Call once, with the Mermaid instance (v11+) to render with.
 * Options: `tag` (element name), `fonts` (load IBM Plex Mono from Google Fonts for the
 * Wermaid palette; default true), `config` (extra Mermaid config).
 */
export function defineWermaidElement(mermaid, { tag = 'wermaid-diagram', fonts = true, config = {} } = {}) {
  // Wermaid renders the blocks itself, so Mermaid must not also auto-render them.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...config });
  engine = createWermaid(mermaid);
  options = { tag, fonts };
  if (!customElements.get(tag)) customElements.define(tag, class extends WermaidDiagram {});
  return customElements.get(tag);
}

/**
 * Replace Mermaid code blocks with <wermaid-diagram> elements and render them.
 * Per-block options can be given as data attributes on the block (`data-theme`,
 * `data-dark`, `data-pannable`, `data-controls`, `data-height`, `data-background`);
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
    for (const name of ['theme', 'dark', 'pannable', 'controls', 'height', 'background']) {
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
  [hidden] { display: none !important; }
  .viewport { position: relative; background: var(--wermaid-bg, transparent); }
  .stage svg { display: block; margin-inline: auto; }
  :host([pannable]) .viewport { height: var(--wermaid-height); overflow: hidden; cursor: grab; touch-action: none; }
  :host([pannable]) .stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  :host([pannable]) .stage svg { margin: 0; max-width: none !important; }
  .viewport.panning, .viewport.panning * { cursor: grabbing !important; }
  .toolbar {
    position: absolute; top: 8px; right: 8px; z-index: 2; display: flex; align-items: center; gap: 2px;
    padding: 2px; background: var(--wermaid-ui-bg); color: var(--wermaid-ui-fg); border: 1px solid var(--wermaid-ui-line);
    font: 12px/1.4 "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  }
  .toolbar button { border: 0; background: none; color: inherit; font: inherit; padding: 4px 7px; cursor: pointer; }
  .toolbar button:hover, .toolbar button:focus-visible { background: var(--wermaid-ui-line); outline: none; }
  .toolbar output { min-width: 4.5ch; text-align: center; color: var(--wermaid-ui-muted); font-variant-numeric: tabular-nums; }
  .menu {
    position: absolute; right: -1px; top: calc(100% + 4px); min-width: 170px; display: grid; padding: 4px 0;
    background: var(--wermaid-ui-bg); border: 1px solid var(--wermaid-ui-line); box-shadow: 0 6px 20px rgba(0,0,0,.08);
  }
  .menu button { text-align: left; padding: 7px 12px; }
  .note { position: absolute; left: 8px; bottom: 8px; z-index: 2; margin: 0; padding: 4px 8px; font: 12px/1.4 ui-monospace, Menlo, monospace;
    background: var(--wermaid-ui-bg); color: var(--wermaid-ui-fg); border: 1px solid var(--wermaid-ui-line); }
  .error { margin: 0; padding: 12px; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #9a4d07; white-space: pre-wrap; }
`;

const TEMPLATE = `
  <style>${STYLE}</style>
  <div class="viewport" part="viewport">
    <div class="stage" part="stage"></div>
    <div class="toolbar" part="toolbar" hidden>
      <span class="zoomers">
        <button type="button" data-act="out" aria-label="Zoom out">−</button>
        <output aria-live="off">100%</output>
        <button type="button" data-act="in" aria-label="Zoom in">+</button>
        <button type="button" data-act="fit">Fit</button>
      </span>
      <span class="exporter" style="position: relative">
        <button type="button" data-act="menu" aria-haspopup="menu" aria-expanded="false">Export ▾</button>
        <div class="menu" role="menu" hidden>
          <button type="button" role="menuitem" data-act="copy-png">Copy as PNG</button>
          <button type="button" role="menuitem" data-act="copy-svg">Copy as SVG</button>
          <button type="button" role="menuitem" data-act="save-png">Save as PNG…</button>
          <button type="button" role="menuitem" data-act="save-svg">Save as SVG…</button>
        </div>
      </span>
    </div>
    <p class="note" part="note" role="status" hidden></p>
  </div>
  <p class="error" part="error" role="alert" hidden></p>
`;

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
let fontLinkAdded = false;

function ensureFonts(theme) {
  const faces = THEMES[theme]?.fonts || [];
  if (!faces.length) return Promise.resolve();
  if (options.fonts && !fontLinkAdded && !document.querySelector(`link[href="${FONT_HREF}"]`)) {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT_HREF }));
    fontLinkAdded = true;
  }
  return Promise.race([
    Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
}

export class WermaidDiagram extends HTMLElement {
  static observedAttributes = ['theme', 'dark', 'src', 'pannable', 'controls', 'height', 'background'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = TEMPLATE;
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this.$ = { viewport: $('.viewport'), stage: $('.stage'), toolbar: $('.toolbar'), zoomers: $('.zoomers'),
      zoomOut: $('output'), menu: $('.menu'), menuBtn: $('[data-act="menu"]'), note: $('.note'), error: $('.error') };
    this._source = null;
    this._diagram = null;
    this._view = { x: 0, y: 0, zoom: 1 };
    this._lastVB = null;
    this._rendered = Promise.resolve(null);
    this._pending = false;
    this._onDark = () => { if ((this.getAttribute('dark') ?? 'auto') === 'auto') this._schedule(); };
    this._wire();
  }

  /** The Mermaid source (with or without a layout block). */
  get source() { return this._source ?? sourceOf(this); }
  set source(text) { this._source = String(text); this._schedule(); }
  /** The latest render result (see createWermaid().render), or null. */
  get diagram() { return this._diagram; }
  /** Promise for the latest render; resolves with the diagram, rejects on error. */
  get rendered() { return this._rendered; }

  connectedCallback() {
    darkQuery?.addEventListener('change', this._onDark);
    if (!this._observer) {
      // Inline source edited after the fact (by a framework, say) re-renders.
      this._observer = new MutationObserver(() => { if (this._source === null) this._schedule(); });
    }
    this._observer.observe(this, { childList: true, characterData: true, subtree: true });
    if (!this._sizeObserver) {
      this._sizeObserver = new ResizeObserver(() => {
        if (!this.hasAttribute('pannable')) return;
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
    if (['theme', 'dark', 'src'].includes(name)) this._schedule();
    else this._applyChrome();
  }

  /** Re-render now. */
  refresh() { this._schedule(); return this._rendered; }
  /** Scale the drawing to the viewer and centre it (pannable viewers). */
  fit() { this._fit(); }

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
      let text = this.source;
      const src = this.getAttribute('src');
      if (src && this._source === null) {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Couldn't load ${src} (${res.status})`);
        text = await res.text();
      }
      text = dedent(text);
      if (!text.trim()) { stage.replaceChildren(); return null; }
      const block = parseSource(text);
      const attr = this.getAttribute('theme');
      const theme = attr === 'none' ? null : attr || block.overrides.settings.theme || DEFAULT_THEME;
      const darkAttr = this.getAttribute('dark') ?? 'auto';
      const dark = darkAttr === 'auto' ? !!darkQuery?.matches : darkAttr !== 'false';
      this.toggleAttribute('data-dark', dark);
      if (theme) await ensureFonts(theme);
      const diagram = await engine.render(stage, text, { id: `wermaid-${++renderCount}`, theme, dark });
      this._diagram = diagram;
      error.hidden = true;
      this._lastVB = null;
      this._applyChrome();
      if (this.hasAttribute('pannable')) this._fit();
      this.dispatchEvent(new CustomEvent('wermaid:render', { detail: { diagram }, bubbles: true, composed: true }));
      return diagram;
    } catch (err) {
      error.textContent = `Couldn't render this diagram.\n${(err?.message || String(err)).split('\n').slice(0, 3).join('\n')}`;
      error.hidden = false;
      this.dispatchEvent(new CustomEvent('wermaid:error', { detail: { error: err }, bubbles: true, composed: true }));
      throw err;
    }
  }

  /* ---------------- chrome: toolbar, background, size ---------------- */

  _applyChrome() {
    const { toolbar, zoomers, viewport } = this.$;
    const pannable = this.hasAttribute('pannable');
    toolbar.hidden = !this.hasAttribute('controls');
    zoomers.hidden = !pannable;
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
    if (this.hasAttribute('pannable')) {
      // The canvas ends a little past the diagram: panning can't lose it off screen.
      const W = this.$.viewport.clientWidth, H = this.$.viewport.clientHeight;
      const top = this.hasAttribute('controls') ? 44 : 16;
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
    if (!svg || !this.hasAttribute('pannable')) return;
    const vb = svg.viewBox.baseVal;
    const W = this.$.viewport.clientWidth, H = this.$.viewport.clientHeight;
    const pad = 24, top = this.hasAttribute('controls') ? 44 : pad;
    const z = Math.max(MIN_ZOOM, Math.min((W - 2 * pad) / vb.width, (H - top - pad) / vb.height, 1.5));
    if (!W || !H) { this._autoFit = true; return; }
    this._view = { zoom: z, x: (W - vb.width * z) / 2, y: top + (H - top - pad - vb.height * z) / 2 };
    this._autoFit = true; // keep fitting on resize until the viewer pans or zooms
    this._lastVB = { x: vb.x, y: vb.y };
    this._sizeSvg();
  }

  _zoomAt(z, ax, ay) {
    this._autoFit = false;
    const v = this._view;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    v.x = ax - (ax - v.x) * (next / v.zoom);
    v.y = ay - (ay - v.y) * (next / v.zoom);
    v.zoom = next;
    this._sizeSvg();
  }

  /* ---------------- interaction ---------------- */

  _wire() {
    const { viewport, toolbar, menu, menuBtn } = this.$;
    const pannable = () => this.hasAttribute('pannable') && this._diagram;

    toolbar.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      const W = viewport.clientWidth, H = viewport.clientHeight;
      if (act === 'in') this._zoomAt(this._view.zoom * 1.25, W / 2, H / 2);
      else if (act === 'out') this._zoomAt(this._view.zoom / 1.25, W / 2, H / 2);
      else if (act === 'fit') this._fit();
      else if (act === 'menu') this._menu(menu.hidden);
      else { this._menu(false); this._export(act); }
    });
    toolbar.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    toolbar.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !menu.hidden) { this._menu(false); menuBtn.focus(); }
    });
    this.addEventListener('focusout', (ev) => {
      if (!menu.hidden && !this.shadowRoot.contains(ev.relatedTarget)) this._menu(false);
    });

    // Ctrl/⌘ + scroll or a trackpad pinch zooms at the pointer; plain scrolling scrolls the page.
    viewport.addEventListener('wheel', (ev) => {
      if (!pannable() || !(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const r = viewport.getBoundingClientRect();
      const unit = ev.deltaMode === 1 ? 16 : 1;
      this._zoomAt(this._view.zoom * Math.exp(-ev.deltaY * unit * 0.01), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    viewport.addEventListener('dblclick', (ev) => { if (pannable() && !ev.target.closest('.toolbar')) this._fit(); });

    const touches = new Map();
    let pan = null, pinch = null;
    viewport.addEventListener('pointerdown', (ev) => {
      if (!pannable() || (ev.button !== 0 && ev.button !== 1)) return;
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

  _menu(open) {
    this.$.menu.hidden = !open;
    this.$.menuBtn.setAttribute('aria-expanded', String(open));
    if (open) this.$.menu.querySelector('button')?.focus();
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
    const name = (this.getAttribute('name') || d.type || 'diagram').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram';
    const background = d.background || getComputedStyle(this).backgroundColor || '#ffffff';
    try {
      if (kind === 'copy-svg') {
        await navigator.clipboard.writeText(d.toSVG());
        this._note('SVG copied');
      } else if (kind === 'copy-png') {
        if (!window.ClipboardItem || !navigator.clipboard?.write) { this._note('This browser can’t copy images'); return; }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': d.toPNG({ background }) })]);
        this._note('PNG copied');
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
