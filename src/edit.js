/*
 * Wermaid editing: drag, resize, bend and nudge a rendered diagram, writing the result into its
 * overrides. Shared by the full editor page and the <wermaid-diagram> element.
 *
 *   const editor = createEditor(surface, { snap, scale, onPreview, onCommit, onSelect });
 *   editor.attach(diagram, diagram.overrides);   // after every render
 *
 * `surface` is the element that holds the diagram's SVG (it may sit in a shadow root). Pointer
 * handling is attached to it; presses on its background are left alone (no preventDefault), so
 * the host can pan. The host owns the source text: it writes `overrides` back on `onPreview`
 * (during a drag) and `onCommit` (once per finished change).
 *
 * The overlay keeps fixed class names (`.wm-overlay`, `.wm-hit`, `[data-handle]`) so exports
 * can strip it and hosts can style it. While a shape is dragged the surface has the class
 * `dragging`.
 */

import { emptyOverrides } from './wermaid.js';

/**
 * @param {Element} surface
 * @param {{ snap?: () => boolean, scale?: () => number, onPreview?: (overrides) => void,
 *   onCommit?: (overrides, reason: 'drag'|'key'|'reset'|'pin'|'style') => void,
 *   onSelect?: (selection) => void }} [options]
 */
export function createEditor(surface, {
  snap = () => false,
  scale = () => 1,
  onPreview = () => {},
  onCommit = () => {},
  onSelect = () => {},
} = {}) {
  const SVGNS = 'http://www.w3.org/2000/svg';
  let diagram = null;
  let overrides = emptyOverrides();
  let selection = null;        // { kind: 'node' | 'cluster' | 'edge', id }
  let showStock = false;
  let drag = null;
  let dragViewBox = null;      // the frame held still while a shape is dragged
  let raf = 0;
  let lastPress = { key: '', time: 0 };

  /* ---------- overrides helpers ---------- */
  function entryFor(kind, id, create = true) {
    const key = kind === 'edge' ? `edge:${id}` : id;
    let e = overrides.targets.get(key);
    if (!e && create) {
      e = { kind: kind === 'edge' ? 'edge' : 'node', selector: id };
      if (kind === 'edge') e.resolved = id;
      overrides.targets.set(key, e);
    }
    return e;
  }
  function clearEntry(kind, id) {
    overrides.targets.delete(kind === 'edge' ? `edge:${id}` : id);
  }
  const snapped = (v) => (snap() ? Math.round(v / 8) * 8 : Math.round(v * 10) / 10);
  const isPinned = (id) => !!entryFor('node', id, false)?.at;

  /** Re-key edge entries by resolved edge id so lookups are stable. */
  function normalizeOverrides() {
    const next = new Map();
    for (const [key, e] of overrides.targets) {
      if (e.kind === 'edge' && e.resolved) next.set(`edge:${e.resolved}`, e);
      else next.set(key, e);
    }
    overrides.targets = next;
  }

  function targetExists(sel) {
    const s = diagram?.scene;
    if (!s) return false;
    return sel.kind === 'node' ? s.nodes.has(sel.id) : sel.kind === 'cluster' ? s.clusters.has(sel.id) : s.edges.has(sel.id);
  }

  /* ---------- edge hit areas ---------- */
  function addHitPaths() {
    if (!diagram?.scene) return;
    for (const e of diagram.scene.edges.values()) {
      if (e.hitEl) continue;
      const hit = diagram.svg.ownerDocument.createElementNS(SVGNS, 'path');
      hit.setAttribute('class', 'wm-hit');
      hit.dataset.wmEdge = e.id;
      e.pathEl.after(hit);
      e.hitEl = hit;
    }
  }
  function syncHitPaths() {
    if (!diagram?.scene) return;
    for (const e of diagram.scene.edges.values()) {
      if (!e.hitEl) continue;
      e.hitEl.setAttribute('d', e.pathEl.getAttribute('d'));
      const t = e.pathEl.getAttribute('transform');
      t ? e.hitEl.setAttribute('transform', t) : e.hitEl.removeAttribute('transform');
      e.hitEl.style.display = showStock ? 'none' : '';
    }
  }

  /* ---------- overlay ---------- */
  function overlayGroup() {
    let g = diagram.svg.querySelector(':scope > g.wm-overlay');
    if (!g) {
      g = el('g', { class: 'wm-overlay' });
      diagram.svg.append(g);
    }
    return g;
  }
  function el(tag, attrs, parent) {
    const n = diagram.svg.ownerDocument.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent?.append(n);
    return n;
  }
  function drawOverlay() {
    if (!diagram?.svg) return;
    const g = overlayGroup();
    g.replaceChildren();
    if (showStock || !diagram.supported || !diagram.geometry) return;
    const k = 1 / scale();
    const geom = diagram.geometry;

    // Small markers on shapes that carry an override.
    for (const [id, n] of geom.nodes) {
      const ov = overrides.targets.get(id);
      if (ov && (ov.at || ov.nudge || ov.size)) el('circle', { class: ov.at ? 'pin' : 'pin hollow', cx: n.box.x + n.box.w, cy: n.box.y, r: 3 * k }, g);
    }
    if (!selection) return;
    if (selection.kind === 'node' || selection.kind === 'cluster') {
      const b = (selection.kind === 'node' ? geom.nodes : geom.clusters).get(selection.id)?.box;
      if (!b) return;
      const p = 4 * k;
      el('rect', { class: 'sel', x: b.x - p, y: b.y - p, width: b.w + 2 * p, height: b.h + 2 * p }, g);
      if (selection.kind === 'node') {
        const s = 8 * k;
        const corners = { nw: [b.x, b.y], ne: [b.x + b.w, b.y], sw: [b.x, b.y + b.h], se: [b.x + b.w, b.y + b.h] };
        for (const [name, [x, y]] of Object.entries(corners)) {
          el('rect', { class: `h corner ${name}`, x: x - s / 2, y: y - s / 2, width: s, height: s, 'data-handle': `corner:${name}` }, g);
        }
      }
    } else if (selection.kind === 'edge') {
      const e = diagram.scene.edges.get(selection.id);
      const ge = geom.edges.get(selection.id);
      if (!e || !ge) return;
      const outline = el('path', { class: 'edge-sel', d: e.pathEl.getAttribute('d') }, g);
      const m = ctmToDiagram(e.pathEl);
      outline.setAttribute('transform', `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`);
      const route = routePoints(selection.id);
      const r = 5 * k;
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i], b = route[i + 1];
        el('circle', { class: 'h add', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: r * 0.85, 'data-handle': `add:${i}` }, g);
      }
      (entryFor('edge', selection.id, false)?.via || []).forEach((v, i) => {
        el('circle', { class: 'h via', cx: v.x, cy: v.y, r, 'data-handle': `via:${i}` }, g);
      });
    }
  }

  /** Matrix from an element's user space to the diagram's, as it is drawn right now. */
  function ctmToDiagram(node) {
    return diagram.svg.getScreenCTM().inverse().multiply(node.getScreenCTM());
  }

  /** Points a user edits for an edge: its two ends plus any waypoints. */
  function routePoints(id) {
    const ge = diagram.geometry.edges.get(id);
    const via = entryFor('edge', id, false)?.via || [];
    if (via.length) return [ge.points[0], ...via, ge.points.at(-1)];
    // Auto route: put the "+" on the drawn line's real midpoint.
    const e = diagram.scene.edges.get(id);
    const mid = e.pathEl.getPointAtLength(e.pathEl.getTotalLength() / 2).matrixTransform(ctmToDiagram(e.pathEl));
    return [ge.points[0], { x: mid.x, y: mid.y }, ge.points.at(-1)];
  }

  /* ---------- applying ---------- */
  function apply() {
    if (!diagram) return;
    if (showStock) diagram.showStock();
    else { diagram.setOverrides(overrides); normalizeOverrides(); }
    if (dragViewBox) {
      // Hold the frame still while dragging; it refits when the drag ends.
      diagram.svg.setAttribute('viewBox', dragViewBox);
    }
    syncHitPaths();
    drawOverlay();
  }

  function commit(reason) {
    apply();
    onCommit(overrides, reason);
  }

  /* ---------- placing nodes: nudge by default, pin on request ---------- */
  /** Put a node's center at an absolute point, stored as a nudge (default) or a pin. */
  function placeNode(id, center, { pin = isPinned(id), snap: onGrid = true } = {}) {
    const e = entryFor('node', id);
    const inh = diagram.geometry.nodes.get(id).inherited;
    const base = diagram.scene.nodes.get(id).box;
    const q = (v) => (onGrid ? snapped(v) : Math.round(v * 10) / 10);
    if (pin) {
      e.at = { x: q(center.x) - inh.x, y: q(center.y) - inh.y };
      delete e.nudge;
    } else {
      e.nudge = { x: q(center.x - inh.x - base.cx), y: q(center.y - inh.y - base.cy) };
      delete e.at;
    }
  }

  /** Move the selected node or subgraph by (dx, dy) diagram units. */
  function moveSelection(dx, dy) {
    if (!diagram?.geometry || !selection) return false;
    const geom = diagram.geometry;
    if (selection.kind === 'node') {
      const n = geom.nodes.get(selection.id);
      placeNode(selection.id, { x: n.box.cx + dx, y: n.box.cy + dy }, { snap: false });
    } else if (selection.kind === 'cluster') {
      const c = geom.clusters.get(selection.id);
      const e = entryFor('cluster', selection.id);
      e.nudge = { x: c.offset.x + dx, y: c.offset.y + dy };
      delete e.at;
    } else return false;
    return true;
  }

  function setPinned(pin) {
    if (!diagram?.geometry || selection?.kind !== 'node') return;
    const n = diagram.geometry.nodes.get(selection.id);
    placeNode(selection.id, { x: n.box.cx, y: n.box.cy }, { pin, snap: false });
    commit('pin');
  }

  function select(sel) {
    const changed = (sel?.kind !== selection?.kind) || (sel?.id !== selection?.id);
    selection = sel ? { kind: sel.kind, id: sel.id } : null;
    drawOverlay();
    if (changed) onSelect(selection);
  }

  /* ---------- pointer interaction ---------- */
  function hitTarget(target) {
    const handle = target.closest('[data-handle]');
    if (handle) return { type: 'handle', handle: handle.dataset.handle };
    const hit = target.closest('.wm-hit');
    if (hit) return { type: 'edge', id: hit.dataset.wmEdge };
    const s = diagram.scene;
    const label = target.closest('g.edgeLabel');
    if (label) for (const e of s.edges.values()) if (e.labelEl === label) return { type: 'label', id: e.id };
    const node = target.closest('g.node');
    if (node) for (const n of s.nodes.values()) if (n.el === node || n.el.contains(node)) return { type: 'node', id: n.id };
    for (const n of s.nodes.values()) if (n.el.contains(target)) return { type: 'node', id: n.id };
    // Clusters: innermost one whose group contains the target.
    let best = null;
    for (const c of s.clusters.values()) if (c.el.contains(target) && (!best || best.depth < c.depth)) best = c;
    if (best) return { type: 'cluster', id: best.id };
    return { type: 'none' };
  }

  /** Pointer events don't report click counts reliably, so detect a double press ourselves. */
  function isDoublePress(key) {
    const now = performance.now();
    const dbl = lastPress.key === key && now - lastPress.time < 400;
    lastPress = dbl ? { key: '', time: 0 } : { key, time: now };
    return dbl;
  }

  function onPointerDown(ev) {
    if (!diagram?.supported || showStock || ev.button !== 0) return;
    // Empty surface: leave it to the host's panning.
    if (!diagram.svg.contains(ev.target)) return;
    const t = hitTarget(ev.target);
    const p0 = diagram.toDiagram(ev.clientX, ev.clientY);
    const geom = diagram.geometry;
    drag = { p0, moved: false, pointerId: ev.pointerId };

    if (t.type === 'handle') {
      const [kind, arg] = t.handle.split(':');
      if (kind === 'corner') {
        const b = geom.nodes.get(selection.id).box;
        const fixed = { nw: [b.x + b.w, b.y + b.h], ne: [b.x, b.y + b.h], sw: [b.x + b.w, b.y], se: [b.x, b.y] }[arg];
        Object.assign(drag, { kind: 'resize', id: selection.id, fixed: { x: fixed[0], y: fixed[1] }, inherited: geom.nodes.get(selection.id).inherited });
      } else if (kind === 'via' && isDoublePress(`${selection.id}:${arg}`)) {
        // Double-click on a bend removes it.
        const e = entryFor('edge', selection.id);
        e.via = e.via.filter((_, i) => i !== +arg);
        if (!e.via.length) delete e.via;
        drag = null;
        ev.preventDefault();
        commit('drag');
        return;
      } else if (kind === 'via') {
        Object.assign(drag, { kind: 'via', id: selection.id, index: +arg, start: { ...entryFor('edge', selection.id).via[+arg] } });
      } else if (kind === 'add') {
        const e = entryFor('edge', selection.id);
        const route = routePoints(selection.id);
        const a = route[+arg], b = route[+arg + 1];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        e.via = [...(e.via || [])];
        const index = Math.min(+arg, e.via.length);
        e.via.splice(index, 0, mid);
        Object.assign(drag, { kind: 'via', id: selection.id, index, start: mid });
      }
    } else if (t.type === 'node') {
      select({ kind: 'node', id: t.id });
      const n = geom.nodes.get(t.id);
      // Alt flips the default: drag nudges, Alt-drag pins (and the reverse for a pinned node).
      Object.assign(drag, { kind: 'node', id: t.id, start: { x: n.box.cx, y: n.box.cy }, pin: isPinned(t.id) !== ev.altKey });
    } else if (t.type === 'cluster') {
      select({ kind: 'cluster', id: t.id });
      Object.assign(drag, { kind: 'cluster', id: t.id, start: { ...geom.clusters.get(t.id).offset } });
    } else if (t.type === 'label') {
      select({ kind: 'edge', id: t.id });
      const ov = entryFor('edge', t.id, false);
      Object.assign(drag, { kind: 'label', id: t.id, start: { ...(ov?.label || { x: 0, y: 0 }) } });
    } else if (t.type === 'edge') {
      select({ kind: 'edge', id: t.id });
      // Pressing on a line adds a bend on the nearest segment and drags it.
      const route = routePoints(t.id);
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < route.length - 1; i++) {
        const d = distToSegment(p0, route[i], route[i + 1]);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      const existing = entryFor('edge', t.id, false)?.via?.length || 0;
      Object.assign(drag, { kind: 'newvia', id: t.id, index: Math.min(bestI, existing), start: { x: p0.x, y: p0.y } });
    } else {
      // Background of the drawing: left to the host (it pans, and a plain click deselects).
      drag = null;
      return;
    }
    surface.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }

  function onPointerMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const p = diagram.toDiagram(ev.clientX, ev.clientY);
    const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) * scale() < 3) return;
      drag.moved = true;
      dragViewBox = diagram.svg.getAttribute('viewBox');
      surface.classList.add('dragging');
      if (drag.kind === 'newvia') {
        const e = entryFor('edge', drag.id);
        e.via = [...(e.via || [])];
        e.via.splice(drag.index, 0, { ...drag.start });
        drag.kind = 'via';
      }
    }
    const s = drag.start;
    switch (drag.kind) {
      case 'node': {
        placeNode(drag.id, { x: s.x + dx, y: s.y + dy }, { pin: drag.pin });
        break;
      }
      case 'cluster': {
        const e = entryFor('cluster', drag.id);
        e.nudge = { x: snapped(s.x + dx), y: snapped(s.y + dy) };
        delete e.at;
        break;
      }
      case 'resize': {
        const q = { x: snapped(p.x), y: snapped(p.y) };
        const w = Math.max(16, Math.abs(q.x - drag.fixed.x)), h = Math.max(16, Math.abs(q.y - drag.fixed.y));
        const cx = drag.fixed.x + Math.sign(q.x - drag.fixed.x || 1) * w / 2;
        const cy = drag.fixed.y + Math.sign(q.y - drag.fixed.y || 1) * h / 2;
        entryFor('node', drag.id).size = { w, h };
        placeNode(drag.id, { x: cx, y: cy }, { snap: false });
        break;
      }
      case 'via': {
        const e = entryFor('edge', drag.id);
        e.via = [...e.via];
        e.via[drag.index] = { x: snapped(s.x + dx), y: snapped(s.y + dy) };
        break;
      }
      case 'label': {
        const e = entryFor('edge', drag.id);
        e.label = { x: Math.round(s.x + dx), y: Math.round(s.y + dy) };
        break;
      }
    }
    scheduleApply();
  }

  function scheduleApply() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; apply(); onPreview(overrides); });
  }

  function endDrag(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const wasMoved = drag.moved;
    drag = null;
    dragViewBox = null;
    surface.classList.remove('dragging');
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (wasMoved) commit('drag');
  }

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', endDrag);
  surface.addEventListener('pointercancel', endDrag);

  /* ---------- keyboard ---------- */
  function handleKey(ev) {
    if (!selection || !diagram?.supported || showStock) return false;
    if (ev.key === 'Escape') { select(null); return true; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      clearEntry(selection.kind, selection.id);
      commit('reset');
      return true;
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (!dir) return false;
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : snap() ? 8 : 1;
    if (moveSelection(dir[0] * step, dir[1] * step)) commit('key');
    return true;
  }

  return {
    /** Take over a freshly rendered diagram (or new overrides for the same one) and draw. */
    attach(next, nextOverrides) {
      diagram = next;
      overrides = nextOverrides || next?.overrides || emptyOverrides();
      addHitPaths();
      if (selection && !targetExists(selection)) { selection = null; onSelect(null); }
      apply();
    },
    get selection() { return selection; },
    select,
    get overrides() { return overrides; },
    apply,
    setStock(on) {
      showStock = !!on;
      apply();
    },
    nudge(dx, dy) {
      if (!diagram?.supported || showStock) return;
      if (moveSelection(dx, dy)) commit('key');
    },
    resetSelection() {
      if (!selection) return;
      clearEntry(selection.kind, selection.id);
      commit('reset');
    },
    pin() { setPinned(true); },
    unpin() { setPinned(false); },
    setEdgeStyle(edgeId, style) {
      if (style) entryFor('edge', edgeId).style = style;
      else { const e = entryFor('edge', edgeId, false); if (e) delete e.style; }
      commit('style');
    },
    handleKey,
    destroy() {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', endDrag);
      surface.removeEventListener('pointercancel', endDrag);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      drag = null; dragViewBox = null;
      surface.classList.remove('dragging');
      diagram?.svg.querySelector(':scope > g.wm-overlay')?.remove();
      for (const e of diagram?.scene?.edges.values() || []) { e.hitEl?.remove(); delete e.hitEl; }
      diagram = null; selection = null;
    },
  };
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Undo and redo over whole source texts. `push` records the text before a change;
 * `undo(current)` / `redo(current)` take the text now shown and return the one to show (or null).
 */
export function createHistory(limit = 200) {
  const undoStack = [], redoStack = [];
  return {
    push(text) {
      if (undoStack.at(-1) === text) return;
      undoStack.push(text);
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    },
    undo(current) {
      if (!undoStack.length) return null;
      redoStack.push(current);
      return undoStack.pop();
    },
    redo(current) {
      if (!redoStack.length) return null;
      undoStack.push(current);
      return redoStack.pop();
    },
    clear() { undoStack.length = 0; redoStack.length = 0; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
  };
}
