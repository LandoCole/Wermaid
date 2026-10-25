/*
 * Wermaid — manual layout overrides for vanilla Mermaid.
 *
 * Pipeline:
 *   1. Split the source into the Mermaid body and the `%% @layout … %% @end` block.
 *   2. Render the body with stock Mermaid (its own layout engine, untouched).
 *   3. Adapter: read the baseline scene — structure from Mermaid's diagram data
 *      (node ids, parents, edges), geometry from the rendered SVG.
 *   4. Apply overrides (pins, nudges, sizes, edge waypoints, label offsets),
 *      re-route only the edges whose endpoints changed, refit subgraphs.
 *
 * The layout block lives in Mermaid comments, so any other Mermaid renderer
 * ignores it and draws the stock layout.
 */

export const VERSION = '0.1.0';

/* ------------------------------------------------------------------ */
/* Layout block: parse                                                 */
/* ------------------------------------------------------------------ */

const START_RE = /^\s*%%\s*@layout\b/;
const END_RE = /^\s*%%\s*@end\b/;

/**
 * Split source into Mermaid body + parsed overrides.
 * @returns {{ body: string, hasBlock: boolean, overrides: Overrides, errors: {line:number,message:string}[] }}
 */
export function parseSource(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => START_RE.test(l));
  if (start === -1) {
    return { body: src, hasBlock: false, overrides: emptyOverrides(), errors: [] };
  }
  let end = lines.findIndex((l, i) => i > start && END_RE.test(l));
  if (end === -1) end = lines.length;
  const blockLines = lines.slice(start + 1, end);
  const body = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n').replace(/\s+$/, '');
  const { overrides, errors } = parseBlockLines(blockLines, start + 2);
  return { body, hasBlock: true, overrides, errors };
}

export function emptyOverrides() {
  return { targets: new Map(), comments: [], settings: {} };
}

/** How edges are drawn. `null` (no setting) keeps Mermaid's own curves on untouched edges. */
export const EDGE_STYLES = ['rounded', 'orthogonal', 'curved'];
const DEFAULT_RADIUS = 6;

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const PAIR_RE = new RegExp(`^(${NUM})\\s*,\\s*(${NUM})$`);
const SIZE_RE = new RegExp(`^(${NUM})\\s*[x×]\\s*(${NUM})$`);

function parseBlockLines(blockLines, firstLineNo) {
  const overrides = emptyOverrides();
  const errors = [];
  blockLines.forEach((raw, i) => {
    const lineNo = firstLineNo + i;
    const text = raw.replace(/^\s*%%\s?/, '').trim();
    if (!text) return;
    if (text.startsWith('#')) {
      overrides.comments.push(text);
      return;
    }
    if (text.startsWith('@')) {
      // Diagram-wide settings, e.g. `@edges orthogonal` or `@edges rounded 10`.
      const [name, ...args] = text.slice(1).split(/\s+/);
      if (name === 'edges') {
        const [style, radius] = args;
        if (!EDGE_STYLES.includes(style)) {
          errors.push({ line: lineNo, message: `@edges expects ${EDGE_STYLES.join(', ')} — got "${style ?? ''}"` });
          return;
        }
        overrides.settings.edges = { style };
        if (radius !== undefined) {
          if (!/^\d+(\.\d+)?$/.test(radius)) errors.push({ line: lineNo, message: `@edges radius must be a number — got "${radius}"` });
          else overrides.settings.edges.radius = +radius;
        }
      } else {
        errors.push({ line: lineNo, message: `unknown setting "@${name}"` });
      }
      return;
    }
    const m = text.match(/^(\S+)(?:\s+(\S+))?/);
    let selector = m[1];
    let rest = text.slice(m[1].length).trim();
    let kind = 'node';
    if (selector === 'edge') {
      selector = m[2];
      rest = rest.slice(m[2]?.length ?? 0).trim();
      kind = 'edge';
      if (!selector) {
        errors.push({ line: lineNo, message: '`edge` needs an edge id, e.g. `edge e1 via 120,80`' });
        return;
      }
    } else if (/(-+>|<-+>|---)/.test(selector)) {
      kind = 'edge';
    }
    const entry = { kind, selector };
    for (const part of rest.split(';').map((s) => s.trim()).filter(Boolean)) {
      const [op, ...args] = part.split(/\s+/);
      const arg = args.join(' ');
      try {
        applyOp(entry, op, arg, args);
      } catch (e) {
        errors.push({ line: lineNo, message: `${selector}: ${e.message}` });
      }
    }
    const key = kind === 'edge' ? `edge:${selector}` : selector;
    const prev = overrides.targets.get(key);
    overrides.targets.set(key, prev ? { ...prev, ...entry } : entry);
  });
  return { overrides, errors };
}

function parsePair(s, what) {
  const m = s.match(PAIR_RE);
  if (!m) throw new Error(`\`${what}\` expects x,y — got "${s}"`);
  return { x: +m[1], y: +m[2] };
}

function applyOp(entry, op, arg, args) {
  switch (op) {
    case 'at':
      entry.at = parsePair(arg, 'at');
      break;
    case 'nudge':
      entry.nudge = parsePair(arg, 'nudge');
      break;
    case 'size': {
      const m = arg.match(SIZE_RE);
      if (!m) throw new Error(`\`size\` expects WxH — got "${arg}"`);
      entry.size = { w: Math.max(4, +m[1]), h: Math.max(4, +m[2]) };
      break;
    }
    case 'via':
      if (entry.kind !== 'edge') throw new Error('`via` only applies to edges');
      entry.via = args.map((a) => parsePair(a, 'via'));
      break;
    case 'label':
      if (entry.kind !== 'edge') throw new Error('`label` only applies to edges');
      entry.label = parsePair(arg, 'label');
      break;
    case 'style':
      if (entry.kind !== 'edge') throw new Error('`style` only applies to edges');
      if (!EDGE_STYLES.includes(arg)) throw new Error(`\`style\` expects ${EDGE_STYLES.join(', ')} — got "${arg}"`);
      entry.style = arg;
      break;
    default:
      throw new Error(`unknown instruction "${op}"`);
  }
}

/* ------------------------------------------------------------------ */
/* Layout block: serialize                                             */
/* ------------------------------------------------------------------ */

const r1 = (n) => {
  const v = Math.round(n * 10) / 10;
  return Object.is(v, -0) ? 0 : v;
};
const fmtPair = (p) => `${r1(p.x)},${r1(p.y)}`;

/** Canonical text for one target's instructions, or '' when it has none. */
function entryOps(e) {
  const ops = [];
  if (e.at) ops.push(`at ${fmtPair(e.at)}`);
  if (e.nudge && (e.nudge.x || e.nudge.y)) ops.push(`nudge ${fmtPair(e.nudge)}`);
  if (e.size) ops.push(`size ${r1(e.size.w)}x${r1(e.size.h)}`);
  if (e.via && e.via.length) ops.push(`via ${e.via.map(fmtPair).join(' ')}`);
  if (e.label && (e.label.x || e.label.y)) ops.push(`label ${fmtPair(e.label)}`);
  if (e.style) ops.push(`style ${e.style}`);
  return ops.join(' ; ');
}

/**
 * Serialize overrides into a `%% @layout` block. `scene` (optional) gives a
 * stable order (Mermaid's node/edge order) and friendlier edge selectors.
 */
export function serializeBlock(overrides, scene) {
  const entries = [...overrides.targets.values()].filter((e) => entryOps(e));
  const edgesSetting = overrides.settings?.edges;
  if (!entries.length && !overrides.comments.length && !edgesSetting) return '';
  const order = new Map();
  if (scene) {
    let i = 0;
    for (const id of scene.clusters.keys()) order.set(id, i++);
    for (const id of scene.nodes.keys()) order.set(id, i++);
    for (const id of scene.edges.keys()) order.set(`edge:${id}`, i++);
  }
  const keyOf = (e) => (e.kind === 'edge' ? `edge:${e.resolved ?? e.selector}` : e.selector);
  entries.sort((a, b) => (order.get(keyOf(a)) ?? 1e9) - (order.get(keyOf(b)) ?? 1e9));
  const label = (e) => (e.kind === 'edge' ? edgeSelector(e, scene) : e.selector);
  const width = Math.max(4, ...entries.map((e) => label(e).length));
  const out = ['%% @layout v1'];
  if (edgesSetting) out.push(`%% @edges ${edgesSetting.style}${edgesSetting.radius !== undefined ? ` ${r1(edgesSetting.radius)}` : ''}`);
  for (const c of overrides.comments) out.push(`%% ${c}`);
  for (const e of entries) out.push(`%% ${label(e).padEnd(width)}  ${entryOps(e)}`);
  out.push('%% @end');
  return out.join('\n');
}

/** Human-friendly edge selector: user ids as `edge e1`, auto ids as `A->B` (or `A->B#2`). */
function edgeSelector(e, scene) {
  const id = e.resolved ?? e.selector;
  const edge = scene?.edges.get(id);
  if (!edge) return e.selector.includes('>') ? e.selector : `edge ${e.selector}`;
  if (!edge.autoId) return `edge ${id}`;
  const twins = [...scene.edges.values()].filter((x) => x.start === edge.start && x.end === edge.end);
  const n = twins.indexOf(edge);
  return `${edge.start}->${edge.end}${twins.length > 1 ? `#${n + 1}` : ''}`;
}

/** Replace (or append, or remove) the layout block in a source string. */
export function writeSource(src, overrides, scene) {
  const { body } = parseSource(src);
  const block = serializeBlock(overrides, scene);
  return block ? `${body}\n\n${block}\n` : `${body}\n`;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const rect = (x, y, w, h) => ({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
const rectFromCenter = (cx, cy, w, h) => rect(cx - w / 2, cy - h / 2, w, h);
const union = (rs) => {
  if (!rs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return rect(x0, y0, x1 - x0, y1 - y0);
};
const eq = (a, b) => Math.abs(a - b) < 0.01;
const samePt = (a, b) => eq(a.x, b.x) && eq(a.y, b.y);

/** Matrix from an element's user space to the root SVG's user space (viewBox units). */
function toRoot(svg, el) {
  return svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
}
function bboxInRoot(svg, el) {
  const b = el.getBBox();
  const m = toRoot(svg, el);
  const pts = [
    [b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height],
  ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return rect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/** First and last coordinate pairs in an SVG path `d`. */
function pathEnds(d) {
  const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
  if (nums.length < 4) return null;
  return {
    first: { x: nums[0], y: nums[1] },
    last: { x: nums[nums.length - 2], y: nums[nums.length - 1] },
  };
}

/** d3.curveBasis, reproduced so re-routed edges match Mermaid's default curve. */
function curveBasis(pts) {
  let x0, y0, x1, y1, state = 0, d = '';
  const f = (n) => r1(n * 10) / 10;
  const bez = (x, y) => {
    d += `C${f((2 * x0 + x1) / 3)},${f((2 * y0 + y1) / 3)},${f((x0 + 2 * x1) / 3)},${f((y0 + 2 * y1) / 3)},${f((x0 + 4 * x1 + x) / 6)},${f((y0 + 4 * y1 + y) / 6)}`;
  };
  for (const { x, y } of pts) {
    switch (state) {
      case 0: state = 1; d += `M${f(x)},${f(y)}`; break;
      case 1: state = 2; break;
      case 2: state = 3; d += `L${f((5 * x0 + x1) / 6)},${f((5 * y0 + y1) / 6)}`; // falls through
      default: bez(x, y);
    }
    x0 = x1; x1 = x; y0 = y1; y1 = y;
  }
  switch (state) {
    case 3: bez(x1, y1); // falls through
    case 2: d += `L${f(x1)},${f(y1)}`;
  }
  return d;
}
function curveLinear(pts) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p.x)},${r1(p.y)}`).join('');
}

const DIAMONDS = new Set(['diamond', 'question', 'diam', 'decision', 'choice']);
const ELLIPSES = new Set(['circle', 'circ', 'doublecircle', 'dbl-circ', 'ellipse', 'stateStart', 'stateEnd', 'filled-circle', 'fr-circ', 'small-circle', 'sm-circ', 'start', 'stop']);

/** Point where a ray from the shape's center toward `p` leaves the shape. */
function boundaryToward(box, shape, p) {
  const dx = p.x - box.cx, dy = p.y - box.cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: box.cx, y: box.cy };
  const hw = box.w / 2, hh = box.h / 2;
  let t;
  if (DIAMONDS.has(shape)) t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else if (ELLIPSES.has(shape)) t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: box.cx + dx * t, y: box.cy + dy * t };
}

/**
 * Port on one side of a shape, offset along that side by `off` (for parallel edges).
 * side: 'l' | 'r' | 't' | 'b'.
 */
function sidePort(box, side, off) {
  const hw = box.w / 2, hh = box.h / 2;
  const horizontal = side === 'l' || side === 'r';
  const half = horizontal ? hh : hw;
  const o = Math.max(-half * 0.6, Math.min(half * 0.6, off));
  let reach = horizontal ? hw : hh; // distance from center to the side at this offset
  if (DIAMONDS.has(box.shape)) reach *= 1 - Math.abs(o) / half;
  else if (ELLIPSES.has(box.shape)) reach *= Math.sqrt(Math.max(0, 1 - (o / half) ** 2));
  switch (side) {
    case 'r': return { x: box.cx + reach, y: box.cy + o };
    case 'l': return { x: box.cx - reach, y: box.cy + o };
    case 'b': return { x: box.cx + o, y: box.cy + reach };
    default: return { x: box.cx + o, y: box.cy - reach };
  }
}

/**
 * Auto route between two boxes: an orthogonal "Z" through the midpoint, drawn
 * with the same curve as Mermaid so it reads like dagre's output.
 * `off` separates parallel edges between the same pair of shapes.
 */
function autoRoute(a, b, off = 0) {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gapX < 0 && gapY < 0) {
    // Overlapping boxes: straight center line, clipped by the shapes.
    return [boundaryToward(a, a.shape, b), boundaryToward(b, b.shape, a)];
  }
  if (gapX >= gapY) {
    const right = b.cx > a.cx;
    const s = sidePort(a, right ? 'r' : 'l', off);
    const t = sidePort(b, right ? 'l' : 'r', off);
    const mx = (s.x + t.x) / 2;
    if (eq(s.y, t.y)) return [s, { x: mx, y: s.y }, t];
    return [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t];
  }
  const down = b.cy > a.cy;
  const s = sidePort(a, down ? 'b' : 't', off);
  const t = sidePort(b, down ? 't' : 'b', off);
  const my = (s.y + t.y) / 2;
  if (eq(s.x, t.x)) return [s, { x: s.x, y: my }, t];
  return [s, { x: s.x, y: my }, { x: t.x, y: my }, t];
}

/** Right-angled route through waypoints, leaving and entering the shapes square to a side. */
function elbowRoute(a, b, via) {
  const sideToward = (box, p) => {
    const dx = p.x - box.cx, dy = p.y - box.cy;
    return Math.abs(dx) / (box.w / 2) >= Math.abs(dy) / (box.h / 2) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't');
  };
  const horiz = (side) => side === 'l' || side === 'r';
  const sa = sideToward(a, via[0]), sb = sideToward(b, via[via.length - 1]);
  const pts = [sidePort(a, sa, 0)];
  let heading = horiz(sa) ? 'h' : 'v';
  const targets = [...via, sidePort(b, sb, 0)];
  targets.forEach((q, i) => {
    const p = pts[pts.length - 1];
    if (!eq(p.x, q.x) && !eq(p.y, q.y)) {
      // The last leg has to arrive along the target side's axis.
      const goH = i === targets.length - 1 ? !horiz(sb) : heading === 'h';
      pts.push(goH ? { x: q.x, y: p.y } : { x: p.x, y: q.y });
      heading = goH ? 'v' : 'h';
    } else {
      heading = eq(p.x, q.x) ? 'v' : 'h';
    }
    pts.push(q);
  });
  return simplify(pts);
}

function viaRoute(a, b, via) {
  return [boundaryToward(a, a.shape, via[0]), ...via, boundaryToward(b, b.shape, via[via.length - 1])];
}

/** Pull an end point back toward its neighbour by `dist` (room for arrowheads). */
function pullBack(p, toward, dist) {
  if (!dist) return p;
  const dx = p.x - toward.x, dy = p.y - toward.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return p;
  const k = Math.min(dist, len * 0.9) / len;
  return { x: p.x - dx * k, y: p.y - dy * k };
}

/* ------------------------------------------------------------------ */
/* Orthogonal router (the approach libavoid uses for orthogonal edges)  */
/*                                                                      */
/*  1. Orthogonal visibility graph: grid lines at every obstacle edge   */
/*     (padded by a margin), at every port stub, and midway between     */
/*     neighbouring lines so routes can run down the middle of gaps.    */
/*  2. Shortest path over (point, heading) states, where each bend      */
/*     costs extra, so routes prefer few, long, straight segments.      */
/*  3. Nudging: overlapping collinear segments of different edges are   */
/*     spread apart so they read as separate lines.                     */
/* ------------------------------------------------------------------ */

const DIRS = [
  { side: 'r', dx: 1, dy: 0 },
  { side: 'b', dx: 0, dy: 1 },
  { side: 'l', dx: -1, dy: 0 },
  { side: 't', dx: 0, dy: -1 },
];

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Sorted unique coordinates, merging values closer than `tol`; keeps a "kind" per line. */
function gridLines(entries, tol = 0.5) {
  entries.sort((p, q) => p.v - q.v);
  const out = [];
  for (const e of entries) {
    const last = out.at(-1);
    if (last && Math.abs(last.v - e.v) < tol) {
      if (e.kind === 'port') last.kind = 'port';
      continue;
    }
    out.push({ ...e });
  }
  // Midlines between neighbours give routes a centred channel through gaps.
  const mids = [];
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i + 1].v - out[i].v > 4) mids.push({ v: (out[i].v + out[i + 1].v) / 2, kind: 'mid' });
  }
  return [...out, ...mids].sort((p, q) => p.v - q.v);
}

/**
 * Route one edge from box `a` to box `b` around `obstacles` (all shape boxes,
 * including a and b). Returns an orthogonal polyline from a's boundary to b's
 * boundary, or null when no route exists.
 */
function routeOrthogonal(a, b, obstacles, { margin = 14, lane = 0, bend = 48 } = {}) {
  const EPS = 0.01;
  const obs = obstacles.map((o) => ({ x0: o.x - margin, y0: o.y - margin, x1: o.x + o.w + margin, y1: o.y + o.h + margin }));
  // Shapes the route starts or ends at may be entered only through their own port stubs.
  const inside = (x, y) => obs.some((o) => x > o.x0 + EPS && x < o.x1 - EPS && y > o.y0 + EPS && y < o.y1 - EPS);

  const toward = { x: b.cx - a.cx, y: b.cy - a.cy };
  const mkPorts = (box, sign) => DIRS.map((d, di) => {
    const p = sidePort(box, d.side, lane);
    const stub = { x: p.x + d.dx * margin, y: p.y + d.dy * margin };
    // Prefer sides that face the other shape; a side facing away costs a detour.
    const facing = sign * (d.dx * toward.x + d.dy * toward.y);
    return { di, p, stub, penalty: facing >= 0 ? 0 : 3 * margin + bend };
  });
  const srcPorts = mkPorts(a, 1);
  const dstPorts = mkPorts(b, -1);

  const xEntries = [], yEntries = [];
  for (const o of obs) {
    xEntries.push({ v: o.x0, kind: 'edge' }, { v: o.x1, kind: 'edge' });
    yEntries.push({ v: o.y0, kind: 'edge' }, { v: o.y1, kind: 'edge' });
  }
  for (const pt of [...srcPorts, ...dstPorts]) {
    xEntries.push({ v: pt.stub.x, kind: 'port' });
    yEntries.push({ v: pt.stub.y, kind: 'port' });
  }
  const xs = gridLines(xEntries), ys = gridLines(yEntries);
  const nx = xs.length, ny = ys.length;
  const idx = (i, j) => i * ny + j;
  const valid = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) valid[idx(i, j)] = inside(xs[i].v, ys[j].v) ? 0 : 1;
  const find = (arr, v) => {
    let best = -1, bd = Infinity;
    for (let k = 0; k < arr.length; k++) { const d = Math.abs(arr[k].v - v); if (d < bd) { bd = d; best = k; } }
    return bd < 0.6 ? best : -1;
  };
  // Routes along lines that hug an obstacle cost a little more than centred ones.
  const wX = (j) => (ys[j].kind === 'edge' ? 1.15 : 1);
  const wY = (i) => (xs[i].kind === 'edge' ? 1.15 : 1);

  const dist = new Float64Array(nx * ny * 4).fill(Infinity);
  const prev = new Int32Array(nx * ny * 4).fill(-1);
  const heap = new MinHeap();
  for (const sp of srcPorts) {
    const i = find(xs, sp.stub.x), j = find(ys, sp.stub.y);
    if (i < 0 || j < 0 || !valid[idx(i, j)]) continue;
    const s = idx(i, j) * 4 + sp.di;
    const c = sp.penalty + margin;
    if (c < dist[s]) { dist[s] = c; prev[s] = -2 - sp.di; heap.push([c, s]); }
  }
  const goals = new Map(); // grid index → port (arrival heading must point into b)
  for (const dp of dstPorts) {
    const i = find(xs, dp.stub.x), j = find(ys, dp.stub.y);
    if (i >= 0 && j >= 0 && valid[idx(i, j)]) goals.set(idx(i, j), dp);
  }
  let bestState = -1, bestCost = Infinity, bestPort = null;
  while (heap.size) {
    const [c, s] = heap.pop();
    if (c > dist[s] || c >= bestCost) continue;
    const node = s >> 2, di = s & 3;
    const gp = goals.get(node);
    if (gp) {
      const into = (gp.di + 2) % 4;
      const turn = di === into ? 0 : di === (into + 2) % 4 ? 2 * bend : bend;
      const total = c + turn + gp.penalty + margin;
      if (total < bestCost) { bestCost = total; bestState = s; bestPort = gp; }
    }
    const i = Math.floor(node / ny), j = node % ny;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (di + 2) % 4) continue; // no U-turns
      const d = DIRS[nd];
      const ni = i + d.dx, nj = j + d.dy;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const n2 = idx(ni, nj);
      if (!valid[n2]) continue;
      const mx = (xs[i].v + xs[ni].v) / 2, my = (ys[j].v + ys[nj].v) / 2;
      if (inside(mx, my)) continue;
      const len = d.dx ? Math.abs(xs[ni].v - xs[i].v) * wX(j) : Math.abs(ys[nj].v - ys[j].v) * wY(i);
      const nc = c + len + (nd === di ? 0 : bend);
      const ns = n2 * 4 + nd;
      if (nc < dist[ns]) { dist[ns] = nc; prev[ns] = s; heap.push([nc, ns]); }
    }
  }
  if (bestState < 0) return null;

  const pts = [];
  let s = bestState, startDir = -1;
  while (s >= 0) {
    const node = s >> 2;
    pts.push({ x: xs[Math.floor(node / ny)].v, y: ys[node % ny].v });
    const p = prev[s];
    if (p < -1) { startDir = -2 - p; break; }
    s = p;
  }
  pts.reverse();
  const startPort = srcPorts[startDir];
  // Grid lines closer than half a pixel were merged, so line each port up with the
  // grid point it leaves from; this keeps the first and last segments exactly straight.
  const align = (port, gridPt, di) => (DIRS[di].dx ? { x: port.x, y: gridPt.y } : { x: gridPt.x, y: port.y });
  return simplify([align(startPort.p, pts[0], startPort.di), ...pts, align(bestPort.p, pts.at(-1), bestPort.di)]);
}

/** Drop repeated and collinear points from an orthogonal polyline. */
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && samePt(out.at(-1), p)) continue;
    if (out.length >= 2) {
      const a = out.at(-2), b = out.at(-1);
      if ((eq(a.x, b.x) && eq(b.x, p.x)) || (eq(a.y, b.y) && eq(b.y, p.y))) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

/**
 * Spread apart overlapping collinear segments that belong to different edges.
 * End segments stay put (they hold the ports); only interior segments move.
 */
function nudgeRoutes(routes, spacing = 8) {
  for (const orient of ['v', 'h']) {
    const segs = [];
    routes.forEach((pts, r) => {
      for (let i = 1; i < pts.length - 2; i++) {
        const a = pts[i], b = pts[i + 1];
        const vertical = eq(a.x, b.x);
        if ((orient === 'v') !== vertical) continue;
        segs.push({
          r, i,
          at: vertical ? a.x : a.y,
          lo: Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x),
          hi: Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x),
        });
      }
    });
    segs.sort((p, q) => p.at - q.at || p.lo - q.lo);
    const used = new Set();
    for (let k = 0; k < segs.length; k++) {
      if (used.has(k)) continue;
      const group = [segs[k]];
      used.add(k);
      for (let m = k + 1; m < segs.length && Math.abs(segs[m].at - segs[k].at) < 1; m++) {
        if (used.has(m)) continue;
        const g = segs[m];
        if (group.some((s) => s.r !== g.r && g.lo < s.hi - 1 && g.hi > s.lo + 1)) { group.push(g); used.add(m); }
      }
      if (group.length < 2) continue;
      group.sort((p, q) => p.lo - q.lo);
      group.forEach((s, n) => {
        const off = (n - (group.length - 1) / 2) * spacing;
        const pts = routes[s.r];
        const key = orient === 'v' ? 'x' : 'y';
        pts[s.i] = { ...pts[s.i], [key]: pts[s.i][key] + off };
        pts[s.i + 1] = { ...pts[s.i + 1], [key]: pts[s.i + 1][key] + off };
      });
    }
  }
}

/** Outward side of a box that a route end leaves from, judged by its first segment. */
function endSide(from, next) {
  if (eq(from.x, next.x)) return next.y > from.y ? 'b' : 't';
  return next.x > from.x ? 'r' : 'l';
}

/**
 * Spread route ends that share one side of one shape along that side, ordered by
 * where each route goes next so they don't cross. `ends` items: { pts, at: 0 | -1, box }.
 */
function distributePorts(ends, spacing = 16) {
  const groups = new Map();
  for (const end of ends) {
    const { pts, at } = end;
    const p = at === 0 ? pts[0] : pts.at(-1);
    const q = at === 0 ? pts[1] : pts.at(-2);
    end.side = endSide(p, q);
    const key = `${end.id}\u0000${end.side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(end);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const horizontalSide = group[0].side === 't' || group[0].side === 'b';
    const along = horizontalSide ? 'x' : 'y';
    const box = group[0].box;
    const room = (horizontalSide ? box.w : box.h) * 0.8;
    const step = Math.min(spacing, room / group.length);
    // Order by where each route heads after its first bend.
    const far = (end) => {
      const pts = end.pts, n = pts.length;
      const k = end.at === 0 ? Math.min(2, n - 1) : Math.max(n - 3, 0);
      return pts[k][along];
    };
    group.sort((u, v) => far(u) - far(v));
    group.forEach((end, n) => {
      const off = (n - (group.length - 1) / 2) * step;
      const pts = end.pts;
      if (pts.length === 2) {
        const mate = end.mate;
        const mateAlone = groups.get(`${mate.id}\u0000${mate.side}`).length < 2;
        const port = sidePort(box, end.side, off);
        const mateBox = mate.box;
        const mateOff = port[along] - (horizontalSide ? mateBox.cx : mateBox.cy);
        const mateHalf = (horizontalSide ? mateBox.w : mateBox.h) / 2;
        if (mateAlone && Math.abs(mateOff) <= mateHalf * 0.6) {
          // Slide both ends together so a straight route stays straight.
          pts[end.at === 0 ? 0 : 1] = port;
          pts[end.at === 0 ? 1 : 0] = sidePort(mateBox, mate.side, mateOff);
          return;
        }
        // Otherwise add a jog so the two ends can shift independently.
        const [a, b] = pts;
        const m = horizontalSide ? { y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2 };
        pts.splice(1, 0, { ...a, ...m }, { ...b, ...m });
      }
      const i = end.at === 0 ? 0 : pts.length - 1;
      const j = end.at === 0 ? 1 : pts.length - 2;
      const port = sidePort(box, end.side, off);
      pts[i] = port;
      pts[j] = { ...pts[j], [along]: port[along] };
    });
  }
}

/** Orthogonal polyline with rounded corners. */
function roundedPath(pts, radius = 6) {
  const f = (n) => r1(n * 10) / 10;
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const lin = Math.hypot(c.x - p.x, c.y - p.y), lout = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, lin / 2, lout / 2);
    if (r < 0.5) { d += `L${f(c.x)},${f(c.y)}`; continue; }
    const a = { x: c.x - ((c.x - p.x) / lin) * r, y: c.y - ((c.y - p.y) / lin) * r };
    const b = { x: c.x + ((n.x - c.x) / lout) * r, y: c.y + ((n.y - c.y) / lout) * r };
    d += `L${f(a.x)},${f(a.y)}Q${f(c.x)},${f(c.y)},${f(b.x)},${f(b.y)}`;
  }
  const last = pts.at(-1);
  return `${d}L${f(last.x)},${f(last.y)}`;
}

/** Does a polyline pass through the interior of a box? */
function polylineHitsBox(pts, box, shrink = 2) {
  const x0 = box.x + shrink, y0 = box.y + shrink, x1 = box.x + box.w - shrink, y1 = box.y + box.h - shrink;
  if (x1 <= x0 || y1 <= y0) return false;
  for (let i = 0; i < pts.length - 1; i++) {
    // Liang–Barsky clip of the segment against the box.
    const p = pts[i], q = pts[i + 1];
    const dx = q.x - p.x, dy = q.y - p.y;
    let t0 = 0, t1 = 1, hit = true;
    for (const [pp, qq] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
      if (pp === 0) { if (qq < 0) { hit = false; break; } continue; }
      const t = qq / pp;
      if (pp < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
    }
    if (hit && t1 > t0) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Attribute bookkeeping: every mutation is reversible                 */
/* ------------------------------------------------------------------ */

class Mutations {
  constructor() { this.saved = new Map(); }
  set(el, attr, value) {
    let rec = this.saved.get(el);
    if (!rec) this.saved.set(el, (rec = new Map()));
    if (!rec.has(attr)) rec.set(attr, el.getAttribute(attr));
    if (value === null) el.removeAttribute(attr);
    else el.setAttribute(attr, value);
  }
  restore() {
    for (const [el, rec] of this.saved) {
      for (const [attr, v] of rec) (v === null ? el.removeAttribute(attr) : el.setAttribute(attr, v));
    }
    this.saved.clear();
  }
}

/**
 * Stretch a cluster's frame to a new box. Each edge of each frame shape is
 * anchored to the nearest edge of the cluster, so title bands and inner
 * panels keep their height while the frame grows around moved contents.
 */
function reshapeFrame(c, box, mut) {
  const old = c.box;
  const d = {
    l: box.x - old.x, r: box.x + box.w - (old.x + old.w),
    t: box.y - old.y, b: box.y + box.h - (old.y + old.h),
  };
  const nearX = (v) => (Math.abs(v - old.x) <= Math.abs(v - (old.x + old.w)) ? d.l : d.r);
  const nearY = (v) => (Math.abs(v - old.y) <= Math.abs(v - (old.y + old.h)) ? d.t : d.b);
  const n = (v) => r1(v * 100) / 100;
  for (const f of c.frame) {
    const fb = f.box, el = f.el;
    const l = nearX(fb.x), r = nearX(fb.x + fb.w), t = nearY(fb.y), b = nearY(fb.y + fb.h);
    if (el.tagName === 'rect') {
      const x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0;
      const w = +el.getAttribute('width') || fb.w, h = +el.getAttribute('height') || fb.h;
      mut.set(el, 'x', n(x + l));
      mut.set(el, 'y', n(y + t));
      mut.set(el, 'width', n(Math.max(1, w + r - l)));
      mut.set(el, 'height', n(Math.max(1, h + b - t)));
    } else if (el.tagName === 'line') {
      const x1 = +el.getAttribute('x1'), x2 = +el.getAttribute('x2');
      const y1 = +el.getAttribute('y1'), y2 = +el.getAttribute('y2');
      mut.set(el, 'x1', n(x1 + (x1 <= x2 ? l : r)));
      mut.set(el, 'x2', n(x2 + (x2 < x1 ? l : r)));
      mut.set(el, 'y1', n(y1 + (y1 <= y2 ? t : b)));
      mut.set(el, 'y2', n(y2 + (y2 < y1 ? t : b)));
    } else {
      // Paths and polygons: map the old local box onto the new one.
      const lb = f.local || (f.local = el.getBBox());
      const sx = lb.width ? (lb.width + r - l) / lb.width : 1;
      const sy = lb.height ? (lb.height + b - t) / lb.height : 1;
      const tx = lb.x + l - lb.x * sx, ty = lb.y + t - lb.y * sy;
      const orig = el.getAttribute('transform');
      mut.set(el, 'transform', `matrix(${n(sx * 10) / 10},0,0,${n(sy * 10) / 10},${n(tx)},${n(ty)})${orig ? ' ' + orig : ''}`);
      mut.set(el, 'vector-effect', 'non-scaling-stroke');
    }
  }
}

const prependTranslate = (orig, dx, dy) => `translate(${r1(dx * 100) / 100}, ${r1(dy * 100) / 100})${orig ? ' ' + orig : ''}`;

/* ------------------------------------------------------------------ */
/* Adapter: read the baseline scene from Mermaid                        */
/* ------------------------------------------------------------------ */

function cssId(s) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1');
}

function findNodeEl(svg, svgId, n) {
  const want = `${svgId}-${n.domId || n.id}`;
  let el = svg.querySelector(`#${cssId(want)}`);
  if (el) return el;
  // Fallback for diagram types whose dom ids drift between parse passes.
  const re = new RegExp(`^${svgId}-(?:[a-zA-Z]+-)?${n.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-\\d+)?$`);
  return [...svg.querySelectorAll('g.node, g[id]')].find((g) => re.test(g.id)) || null;
}

function readScene(svg, svgId, data, direction) {
  const scene = {
    svg, svgId, direction,
    nodes: new Map(), clusters: new Map(), edges: new Map(),
    warnings: [],
  };
  const root = svg;
  for (const n of data.nodes) {
    if (n.isGroup) {
      const el = svg.querySelector(`#${cssId(`${svgId}-${n.domId || n.id}`)}`)
        || svg.querySelector(`g[data-id="${cssId(n.id)}"]`);
      if (!el) continue;
      const labelEl = el.querySelector('.cluster-label') || el.querySelector(':scope > g.label');
      // Frame parts: every drawn shape in the cluster except its title label.
      const frame = [...el.querySelectorAll('rect, path, polygon, line, ellipse')]
        .filter((s) => !(labelEl && labelEl.contains(s)))
        .map((s) => ({ el: s, box: bboxInRoot(root, s) }));
      if (!frame.length) continue;
      scene.clusters.set(n.id, {
        id: n.id, el, labelEl, frame,
        parent: n.parentId || null,
        box: union(frame.map((f) => f.box)),
        children: [],
      });
    }
  }
  for (const n of data.nodes) {
    if (n.isGroup) continue;
    const el = findNodeEl(svg, svgId, n);
    if (!el) continue;
    const box = bboxInRoot(root, el);
    scene.nodes.set(n.id, {
      id: n.id, el,
      shape: n.shape,
      parent: n.parentId && scene.clusters.has(n.parentId) ? n.parentId : null,
      box: { ...box, shape: n.shape },
      shapeEls: [...el.children].filter((c) => !c.matches('.label, g.label, text, foreignObject')),
    });
  }
  // Cluster membership + padding between a cluster's frame and its contents.
  for (const c of scene.clusters.values()) {
    if (c.parent && !scene.clusters.has(c.parent)) c.parent = null;
    if (c.parent) scene.clusters.get(c.parent).children.push({ type: 'cluster', id: c.id });
  }
  for (const n of scene.nodes.values()) {
    if (n.parent) scene.clusters.get(n.parent).children.push({ type: 'node', id: n.id });
  }
  for (const c of scene.clusters.values()) {
    const inner = union(c.children.map((ch) => (ch.type === 'node' ? scene.nodes : scene.clusters).get(ch.id).box));
    c.pad = inner
      ? { l: inner.x - c.box.x, t: inner.y - c.box.y, r: c.box.x + c.box.w - (inner.x + inner.w), b: c.box.y + c.box.h - (inner.y + inner.h) }
      : null;
    c.depth = 0;
    for (let p = c.parent; p; p = scene.clusters.get(p).parent) c.depth++;
    if (c.labelEl) c.labelBox = bboxInRoot(root, c.labelEl);
  }
  for (const e of data.edges) {
    const pathEl = svg.querySelector(`path[data-edge][data-id="${cssId(e.id)}"]`) || svg.querySelector(`#${cssId(`${svgId}-${e.id}`)}`);
    if (!pathEl) continue;
    const m = toRoot(root, pathEl);
    let points = [];
    try {
      points = JSON.parse(atob(pathEl.dataset.points || '')) || [];
    } catch { /* older Mermaid: no data-points */ }
    const ends = pathEnds(pathEl.getAttribute('d') || '');
    const pull = { start: 0, end: 0 };
    if (points.length >= 2 && ends) {
      pull.start = Math.hypot(points[0].x - ends.first.x, points[0].y - ends.first.y);
      pull.end = Math.hypot(points.at(-1).x - ends.last.x, points.at(-1).y - ends.last.y);
    }
    const toGlobal = (p) => new DOMPoint(p.x, p.y).matrixTransform(m);
    const labelInner = svg.querySelector(`g.edgeLabel > g.label[data-id="${cssId(e.id)}"]`);
    const labelEl = labelInner?.parentElement || null;
    let labelBox = null;
    if (labelEl) {
      const b = labelEl.getBBox();
      if (b.width > 0 && b.height > 0) labelBox = bboxInRoot(root, labelEl);
    }
    scene.edges.set(e.id, {
      id: e.id,
      autoId: /^L[-_]/.test(e.id) || /^(id|edge)[\d_-]/.test(e.id),
      start: e.start, end: e.end,
      pathEl, local: m,
      points: points.map(toGlobal).map((p) => ({ x: p.x, y: p.y })),
      pull,
      labelEl: labelBox ? labelEl : null,
      labelBox,
      // Empty labels still draw a tiny background chip; it's hidden once the edge moves away.
      emptyLabelEl: !labelBox && labelEl ? labelEl : null,
    });
  }
  const titleEl = svg.querySelector('.flowchartTitleText, .statediagramTitleText, .classDiagramTitleText');
  scene.titleBox = titleEl ? bboxInRoot(root, titleEl) : null;
  scene.viewBox = svg.getAttribute('viewBox');
  scene.style = svg.getAttribute('style');
  return scene;
}

/* ------------------------------------------------------------------ */
/* Apply overrides                                                     */
/* ------------------------------------------------------------------ */

/** Resolve an edge selector (`e1`, `L_A_B_0`, `A->B`, `A->B#2`) to an edge id. */
export function resolveEdge(scene, selector) {
  if (scene.edges.has(selector)) return selector;
  const m = selector.match(/^(.+?)\s*(?:-+>|---|<-+>)\s*(.+?)(?:#(\d+))?$/);
  if (!m) return null;
  const [, a, b, n] = m;
  const twins = [...scene.edges.values()].filter((e) => e.start === a && e.end === b);
  return twins[(n ? +n : 1) - 1]?.id ?? null;
}

function applyOverrides(scene, overrides, mut) {
  mut.restore();
  const warnings = [];
  const geom = { nodes: new Map(), clusters: new Map(), edges: new Map(), changed: false };

  // Resolve targets.
  const nodeOv = new Map(), clusterOv = new Map(), edgeOv = new Map();
  for (const [key, e] of overrides.targets) {
    if (e.kind === 'edge') {
      const id = resolveEdge(scene, e.selector);
      e.resolved = id || undefined;
      if (!id) warnings.push(`No edge matches "${e.selector}". Its override is ignored.`);
      else edgeOv.set(id, e);
    } else if (scene.nodes.has(e.selector)) nodeOv.set(e.selector, e);
    else if (scene.clusters.has(e.selector)) clusterOv.set(e.selector, e);
    else warnings.push(`No node or subgraph named "${e.selector}". Its override is ignored.`);
  }

  // Cluster offsets (a dragged subgraph carries everything inside it).
  const ownOffset = new Map();
  for (const c of scene.clusters.values()) {
    const ov = clusterOv.get(c.id);
    let off = { x: 0, y: 0 };
    if (ov?.at) off = { x: ov.at.x - c.box.cx, y: ov.at.y - c.box.cy };
    if (ov?.nudge) off = { x: off.x + ov.nudge.x, y: off.y + ov.nudge.y };
    ownOffset.set(c.id, off);
  }
  const inheritedOffset = (parent) => {
    const o = { x: 0, y: 0 };
    for (let p = parent; p; p = scene.clusters.get(p).parent) {
      const a = ownOffset.get(p);
      o.x += a.x; o.y += a.y;
    }
    return o;
  };

  // Nodes.
  for (const n of scene.nodes.values()) {
    const ov = nodeOv.get(n.id);
    const inh = inheritedOffset(n.parent);
    let cx = n.box.cx, cy = n.box.cy;
    if (ov?.at) { cx = ov.at.x; cy = ov.at.y; }
    if (ov?.nudge) { cx += ov.nudge.x; cy += ov.nudge.y; }
    cx += inh.x; cy += inh.y;
    const w = ov?.size?.w ?? n.box.w, h = ov?.size?.h ?? n.box.h;
    const box = { ...rectFromCenter(cx, cy, w, h), shape: n.shape };
    const dx = cx - n.box.cx, dy = cy - n.box.cy;
    const resized = !eq(w, n.box.w) || !eq(h, n.box.h);
    const moved = !eq(dx, 0) || !eq(dy, 0);
    if (moved) mut.set(n.el, 'transform', prependTranslate(n.el.getAttribute('transform'), dx, dy));
    if (resized) {
      const sx = w / n.box.w, sy = h / n.box.h;
      for (const s of n.shapeEls) {
        mut.set(s, 'transform', `scale(${r1(sx * 1000) / 1000}, ${r1(sy * 1000) / 1000})${s.getAttribute('transform') ? ' ' + s.getAttribute('transform') : ''}`);
        for (const g of [s, ...s.querySelectorAll('path, rect, polygon, circle, ellipse, line, polyline')]) {
          mut.set(g, 'vector-effect', 'non-scaling-stroke');
        }
      }
    }
    geom.nodes.set(n.id, {
      box, delta: { x: dx, y: dy }, resized, changed: moved || resized,
      inherited: inh, at: { x: cx - inh.x, y: cy - inh.y },
    });
    if (moved || resized) geom.changed = true;
  }

  // Clusters, deepest first, refit around their (possibly moved) contents.
  const clusters = [...scene.clusters.values()].sort((a, b) => b.depth - a.depth);
  for (const c of clusters) {
    const kids = c.children.map((ch) => (ch.type === 'node' ? geom.nodes : geom.clusters).get(ch.id));
    const changed = kids.some((k) => k.changed);
    let box = c.box;
    if (changed && c.pad) {
      const inner = union(kids.map((k) => k.box));
      box = rect(inner.x - c.pad.l, inner.y - c.pad.t, inner.w + c.pad.l + c.pad.r, inner.h + c.pad.t + c.pad.b);
      reshapeFrame(c, box, mut);
      if (c.labelEl) {
        mut.set(c.labelEl, 'transform', prependTranslate(c.labelEl.getAttribute('transform'), box.cx - c.box.cx, box.y - c.box.y));
      }
      geom.changed = true;
    }
    geom.clusters.set(c.id, {
      box: { ...box, shape: 'rect' }, changed,
      delta: { x: box.cx - c.box.cx, y: box.cy - c.box.cy },
      resized: !eq(box.w, c.box.w) || !eq(box.h, c.box.h),
      offset: ownOffset.get(c.id), inherited: inheritedOffset(c.parent),
    });
  }

  // Edges: untouched, translated, or re-routed.
  const curve = scene.curve === 'linear' ? curveLinear : curveBasis;
  // Parallel edges between the same two shapes (either direction) get separate lanes.
  const pairs = new Map();
  for (const e of scene.edges.values()) {
    const k = [e.start, e.end].sort().join('\u0000');
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(e.id);
  }
  const laneOffset = (e) => {
    const list = pairs.get([e.start, e.end].sort().join('\u0000'));
    return (list.indexOf(e.id) - (list.length - 1) / 2) * 18;
  };
  // Pass 1 — decide what each edge needs: stock (untouched), shift (both ends moved
  // together), or route (ends moved apart, a shape now sits on it, or bends were added).
  const obstacles = [...geom.nodes.values()].map((g) => g.box);
  const movedBoxes = [...geom.nodes.entries()].filter(([, g]) => g.changed);
  const plans = [];
  const edgeSetting = overrides.settings?.edges || null;
  for (const e of scene.edges.values()) {
    const ov = edgeOv.get(e.id);
    // The look this edge is drawn in: its own `style`, else `@edges`, else Mermaid's (null).
    const look = ov?.style || edgeSetting?.style || null;
    const a = geom.nodes.get(e.start) || geom.clusters.get(e.start);
    const b = geom.nodes.get(e.end) || geom.clusters.get(e.end);
    if (!a || !b) continue;
    const da = a.delta, db = b.delta;
    const hasVia = !!ov?.via?.length;
    const selfLoop = e.start === e.end;
    let mode = 'stock', shift = { x: 0, y: 0 }, points = e.points;
    if (!hasVia && samePt(da, db) && (!(a.resized || b.resized) || selfLoop)) {
      if (!eq(da.x, 0) || !eq(da.y, 0)) {
        mode = 'shift';
        shift = da;
        points = e.points.map((p) => ({ x: p.x + da.x, y: p.y + da.y }));
      }
      // A shape moved onto this edge: route around it instead.
      const blocked = !selfLoop && movedBoxes.some(([id, g]) => id !== e.start && id !== e.end && polylineHitsBox(points, g.box));
      if (blocked) mode = 'route';
    } else if (!selfLoop) {
      mode = 'route';
    }
    // Orthogonal looks can't reuse Mermaid's curve, so every such edge gets routed.
    if ((look === 'orthogonal' || look === 'rounded') && !selfLoop) mode = 'route';
    plans.push({ e, ov, a, b, mode, shift, points, hasVia, look });
  }

  // Pass 2 — route, then nudge overlapping segments apart.
  const routed = [];
  for (const pl of plans) {
    if (pl.mode !== 'route') continue;
    if (pl.hasVia) {
      const square = pl.look === 'orthogonal' || pl.look === 'rounded';
      pl.points = square ? elbowRoute(pl.a.box, pl.b.box, pl.ov.via) : viaRoute(pl.a.box, pl.b.box, pl.ov.via);
      pl.style = square ? 'orthogonal' : 'curve';
      continue;
    }
    const others = obstacles.filter((o) => o !== pl.a.box && o !== pl.b.box);
    const obs = [...others];
    // Endpoint shapes block the route too, unless they're subgraphs the route starts inside.
    if (geom.nodes.has(pl.e.start)) obs.push(pl.a.box);
    if (geom.nodes.has(pl.e.end)) obs.push(pl.b.box);
    // Tight gaps get short port stubs so the route doesn't have to detour.
    const A = pl.a.box, B = pl.b.box;
    const gap = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w), B.y - (A.y + A.h), A.y - (B.y + B.h));
    const margin = gap > 0 ? Math.max(4, Math.min(14, gap / 3)) : 14;
    const pts = routeOrthogonal(A, B, obs, { margin });
    if (pts && pts.length >= 2) {
      pl.points = pts;
      pl.style = 'orthogonal';
      routed.push(pl);
    } else {
      pl.points = autoRoute(pl.a.box, pl.b.box, laneOffset(pl.e));
      pl.style = pl.look === 'orthogonal' || pl.look === 'rounded' ? 'orthogonal' : 'curve';
    }
  }
  distributePorts(routed.flatMap((pl) => {
    const s = { pts: pl.points, at: 0, id: pl.e.start, box: pl.a.box };
    const t = { pts: pl.points, at: -1, id: pl.e.end, box: pl.b.box };
    s.mate = t; t.mate = s;
    return [s, t];
  }));
  for (const pl of routed) pl.points = simplify(pl.points);
  nudgeRoutes(routed.map((pl) => pl.points));

  // Pass 3 — draw paths.
  const radius = edgeSetting?.radius ?? DEFAULT_RADIUS;
  for (const { e, mode, shift, points, style, look } of plans) {
    if (mode === 'shift') {
      mut.set(e.pathEl, 'transform', prependTranslate(e.pathEl.getAttribute('transform'), shift.x, shift.y));
    } else if (mode === 'route') {
      const drawn = points.slice();
      drawn[0] = pullBack(drawn[0], drawn[1], e.pull.start);
      drawn[drawn.length - 1] = pullBack(drawn.at(-1), drawn.at(-2), e.pull.end);
      const inv = e.local.inverse();
      const local = (p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(inv); return { x: q.x, y: q.y }; };
      const pts = drawn.map(local);
      // Orthogonal routes: square corners, rounded corners (the default), or smoothed into a curve.
      const d = style !== 'orthogonal' || look === 'curved' ? curve(pts)
        : roundedPath(pts, look === 'orthogonal' ? 0 : radius);
      mut.set(e.pathEl, 'd', d);
      mut.set(e.pathEl, 'data-points', btoa(JSON.stringify(points.map(local))));
      if (e.emptyLabelEl) mut.set(e.emptyLabelEl, 'visibility', 'hidden');
    }
  }

  // Pass 4 — labels. Labels on untouched edges keep their place; labels on re-routed
  // edges slide along their path to the first spot that doesn't cover a shape or another label.
  const placed = [...geom.nodes.values()].map((g) => g.box);
  const overlaps = (r) => placed.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
  const ordered = [...plans.filter((p) => p.mode !== 'route'), ...plans.filter((p) => p.mode === 'route')];
  for (const { e, ov, mode, shift, points, style, look } of ordered) {
    const labelOff = ov?.label || { x: 0, y: 0 };
    let labelAuto = null;
    if (e.labelEl && e.labelBox) {
      if (mode === 'route') {
        const lane = pairs.get([e.start, e.end].sort().join('\u0000'));
        const first = lane.length > 1 ? 0.35 + (0.3 * lane.indexOf(e.id)) / (lane.length - 1) : 0.5;
        const len = e.pathEl.getTotalLength();
        const at = (f) => {
          const q = e.pathEl.getPointAtLength(len * f).matrixTransform(e.local);
          return { x: q.x, y: q.y };
        };
        labelAuto = at(first);
        for (const f of [first, 0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8]) {
          const c = at(f);
          if (!overlaps(rectFromCenter(c.x, c.y, e.labelBox.w + 4, e.labelBox.h + 4))) { labelAuto = c; break; }
        }
      } else {
        labelAuto = { x: e.labelBox.cx + shift.x, y: e.labelBox.cy + shift.y };
      }
      const tx = labelAuto.x + labelOff.x - e.labelBox.cx, ty = labelAuto.y + labelOff.y - e.labelBox.cy;
      if (!eq(tx, 0) || !eq(ty, 0)) {
        mut.set(e.labelEl, 'transform', prependTranslate(e.labelEl.getAttribute('transform'), tx, ty));
        geom.changed = true;
      }
    }
    const labelBox = e.labelBox && labelAuto
      ? rectFromCenter(labelAuto.x + labelOff.x, labelAuto.y + labelOff.y, e.labelBox.w, e.labelBox.h) : null;
    if (labelBox) placed.push(labelBox);
    if (mode !== 'stock') geom.changed = true;
    geom.edges.set(e.id, {
      mode, style: style || 'stock', look, points, via: ov?.via || [], labelAuto, labelBox, labelOffset: labelOff,
    });
  }

  // Refit the viewBox only when something moved, so an untouched diagram stays byte-identical.
  if (geom.changed) {
    const boxes = [
      ...[...geom.nodes.values()].map((g) => g.box),
      ...[...geom.clusters.values()].map((g) => g.box),
      ...[...geom.edges.values()].filter((g) => g.labelBox).map((g) => g.labelBox),
      ...[...scene.edges.values()].map((e) => bboxInRoot(scene.svg, e.pathEl)),
    ];
    if (scene.titleBox) boxes.push(scene.titleBox);
    const u = union(boxes);
    const pad = scene.padding;
    mut.set(scene.svg, 'viewBox', `${r1(u.x - pad)} ${r1(u.y - pad)} ${r1(u.w + 2 * pad)} ${r1(u.h + 2 * pad)}`);
    mut.set(scene.svg, 'style', `max-width: ${r1(u.w + 2 * pad)}px;`);
  }
  geom.warnings = warnings;
  return geom;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

let counter = 0;

/**
 * Create a Wermaid renderer bound to a Mermaid instance (v11+).
 *
 *   const wermaid = createWermaid(mermaid);
 *   const diagram = await wermaid.render(container, source);
 *   diagram.setOverrides(overrides);   // re-apply without re-running Mermaid
 */
export function createWermaid(mermaid) {
  async function render(container, source, { id } = {}) {
    const parsed = parseSource(source);
    const svgId = id || `wm-${++counter}`;
    const { svg: svgText, bindFunctions } = await mermaid.render(svgId, parsed.body);
    container.innerHTML = svgText;
    const svg = container.querySelector('svg');
    bindFunctions?.(container);

    let data = null, type = null, direction = null, curve = 'basis';
    try {
      const diag = await mermaid.mermaidAPI.getDiagramFromText(parsed.body);
      type = diag.type;
      if (typeof diag.db.getData === 'function') {
        data = diag.db.getData();
        direction = diag.db.getDirection?.() ?? null;
      }
      const cfg = mermaid.mermaidAPI.getConfig?.() || {};
      curve = cfg.flowchart?.curve || 'basis';
    } catch { /* fall through to stock-only */ }

    const supported = !!(data && data.nodes?.length && svg.querySelector('g.node'));
    const scene = supported ? readScene(svg, svgId, data, direction) : null;
    if (scene) {
      scene.curve = curve;
      scene.padding = 8;
    }
    const mut = new Mutations();
    let overrides = parsed.overrides;
    let geom = null;

    const diagram = {
      svg, svgId, type, supported, scene,
      parseErrors: parsed.errors,
      get overrides() { return overrides; },
      get geometry() { return geom; },
      get warnings() { return geom?.warnings ?? []; },
      /** Re-apply a set of overrides to the already-rendered diagram. */
      setOverrides(next) {
        overrides = next;
        if (scene) geom = applyOverrides(scene, overrides, mut);
        return geom;
      },
      /** Show the stock Mermaid layout (overrides kept, just not drawn). */
      showStock() {
        mut.restore();
        geom = scene ? applyOverrides(scene, emptyOverrides(), mut) : null;
        return geom;
      },
      /** Current source text with this diagram's overrides written back. */
      writeSource(src) { return writeSource(src, overrides, scene); },
      /** Client (screen) coordinates → diagram coordinates. */
      toDiagram(clientX, clientY) {
        return new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
      },
    };
    diagram.setOverrides(overrides);
    return diagram;
  }

  return { render, parseSource, serializeBlock, writeSource, emptyOverrides, resolveEdge, EDGE_STYLES, VERSION };
}

export default createWermaid;
