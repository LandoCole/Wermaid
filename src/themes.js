/*
 * Wermaid palettes: named looks for diagrams, applied per diagram as a Mermaid
 * `%%{init}%%` directive so they never touch the page's global Mermaid config.
 *
 *   mermaid  Mermaid's own black-and-white theme (`neutral`; `dark` in dark mode)
 *   wermaid  thin outlines, IBM Plex Mono, no fills
 *   pele     the look of Pele (pele.run): filled rounded nodes, Flexoki colours,
 *            system sans. Reads `--pele-*` CSS variables from the page when set,
 *            so an existing Pele skin carries over.
 *
 * Thanks: the `pele` palette is a thank-you to Pele, the Mermaid renderer by Steph Ango
 * (kepano), made for Obsidian: https://pele.run · https://github.com/obsidianmd/pele (MIT)
 * · https://stephango.com. Its colours are Flexoki, also by Steph Ango
 * (https://stephango.com/flexoki). Wermaid borrows only the look: the palette is
 * re-expressed as a Mermaid theme, and no Pele code is included.
 *
 * A palette may carry `credit` ({ text, links: [{ label, href }] }); the editor and the demo
 * show it whenever that palette is in use.
 *
 * Pages add their own themes with `defineTheme(name, spec)`: plain data (colours, font, shapes,
 * edges, spacing, an optional dark variant) compiled onto Mermaid's `base` theme. See `defineTheme`.
 */

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Inter Variable", Inter, "Segoe UI", Helvetica, Arial, sans-serif';

/** Theme variables shared by palettes built on Mermaid's `base` theme. */
function baseVariables(c, font, fontSize, dark) {
  return {
    darkMode: dark, background: c.bg, fontFamily: font, fontSize,
    primaryColor: c.fill, primaryTextColor: c.fg, primaryBorderColor: c.border,
    secondaryColor: c.fill, secondaryTextColor: c.fg, secondaryBorderColor: c.border,
    tertiaryColor: c.fill, tertiaryTextColor: c.fg, tertiaryBorderColor: c.border,
    mainBkg: c.fill, nodeBorder: c.border, nodeTextColor: c.fg, textColor: c.fg, titleColor: c.fg,
    lineColor: c.line, clusterBkg: c.cluster, clusterBorder: c.clusterBorder, edgeLabelBackground: c.labelBg ?? c.bg,
    classText: c.fg, labelBackgroundColor: c.labelBg ?? c.bg,
    stateBkg: c.fill, stateBorder: c.border, transitionColor: c.line, transitionLabelColor: c.muted,
    specialStateColor: c.line, innerEndBackground: c.line, compositeBackground: c.cluster,
    compositeTitleBackground: c.cluster, altBackground: c.cluster, stateLabelColor: c.fg,
    actorBkg: c.fill, actorBorder: c.border, actorTextColor: c.fg, actorLineColor: c.clusterBorder,
    signalColor: c.line, signalTextColor: c.fg, noteBkgColor: c.cluster, noteBorderColor: c.clusterBorder,
    noteTextColor: c.muted, activationBkgColor: c.fill, activationBorderColor: c.border,
    labelBoxBkgColor: c.fill, labelBoxBorderColor: c.border, labelTextColor: c.fg, loopTextColor: c.muted,
  };
}

const WERMAID = {
  light: { bg: '#F9F9F7', fg: '#1E1F22', muted: '#696A6F', line: '#1E1F22', fill: '#F9F9F7', border: '#8E8E93', cluster: '#F9F9F7', clusterBorder: '#BDBDC1' },
  dark: { bg: '#151516', fg: '#E7E7E3', muted: '#9B9CA0', line: '#E7E7E3', fill: '#151516', border: '#67676D', cluster: '#151516', clusterBorder: '#3A3A3F' },
};

// Pele's published light and dark skins (Flexoki).
const PELE = {
  light: { bg: '#fffcf0', fg: '#100f0f', muted: '#6f6e69', line: '#100f0f', surface: '#f2f0e5', surfaceAlt: '#e6e4d9', border: '#cecdc3', accent: '#205ea6', radius: 6 },
  dark: { bg: '#100f0f', fg: '#cecdc3', muted: '#878580', line: '#cecdc3', surface: '#1c1b1a', surfaceAlt: '#282726', border: '#403e3c', accent: '#4385be', radius: 6 },
};
const PELE_VARS = {
  bg: '--pele-bg', fg: '--pele-fg', muted: '--pele-muted', line: '--pele-line', surface: '--pele-surface',
  surfaceAlt: '--pele-surface-alt', border: '--pele-border', accent: '--pele-accent', radius: '--pele-radius', font: '--pele-font',
};

/** Pele colours, taking any `--pele-*` variables defined around `el` over the defaults. */
function peleColors(dark, el) {
  const c = { ...(dark ? PELE.dark : PELE.light), font: SANS };
  if (el && typeof getComputedStyle === 'function') {
    const cs = getComputedStyle(el);
    for (const [key, name] of Object.entries(PELE_VARS)) {
      const v = cs.getPropertyValue(name).trim();
      if (!v) continue;
      c[key] = key === 'radius' ? parseFloat(v) || c.radius : v;
    }
  }
  return c;
}

export const THEMES = {
  mermaid: {
    label: 'Mermaid',
    edges: null, stylesheet: null,
    background: (dark) => (dark ? '#333333' : '#ffffff'),
    config: ({ dark }) => ({ theme: dark ? 'dark' : 'neutral' }),
  },
  wermaid: {
    label: 'Wermaid',
    edges: null, stylesheet: null,
    fonts: ['400 13px "IBM Plex Mono"', '500 13px "IBM Plex Mono"'],
    background: (dark) => (dark ? WERMAID.dark.bg : WERMAID.light.bg),
    config: ({ dark }) => {
      const c = dark ? WERMAID.dark : WERMAID.light;
      return {
        theme: 'base', fontFamily: MONO,
        flowchart: { htmlLabels: true, padding: 14, nodeSpacing: 56, rankSpacing: 56 },
        themeVariables: baseVariables(c, MONO, '13px', dark),
        themeCSS: `
          .node rect, .node polygon, .node circle, .node ellipse, .node path, .cluster rect,
          .statediagram-cluster rect, .classGroup rect, .divider, .actor { stroke-width: 1px !important; }
          .flowchart-link, .transition, .relation { stroke-width: 1px !important; }
          .edgeLabel, .edgeLabel p, .edgeLabel span { color: ${c.muted} !important; font-size: 12px; }
          .edgeLabel rect, .labelBkg { fill: ${c.bg} !important; background-color: ${c.bg} !important; }
          .cluster-label span, .cluster-label p { color: ${c.fg}; font-weight: 500; }`,
      };
    },
  },
  pele: {
    label: 'Pele',
    edges: null, stylesheet: null,
    credit: {
      text: 'Pele palette: thanks to Steph Ango (kepano) for Pele and its Flexoki colours',
      links: [
        { label: 'pele.run', href: 'https://pele.run' },
        { label: 'GitHub', href: 'https://github.com/obsidianmd/pele' },
        { label: 'Steph Ango', href: 'https://stephango.com' },
      ],
    },
    background: (dark, el) => peleColors(dark, el).bg,
    config: ({ dark, el }) => {
      const p = peleColors(dark, el);
      const c = { bg: p.bg, fg: p.fg, muted: p.muted, line: p.line, fill: p.surface, border: p.border, cluster: p.bg, clusterBorder: p.border };
      const r = p.radius;
      return {
        theme: 'base', fontFamily: p.font,
        flowchart: { htmlLabels: true, padding: 16, nodeSpacing: 48, rankSpacing: 52 },
        themeVariables: baseVariables(c, p.font, '14px', dark),
        themeCSS: `
          .node rect, .node polygon, .node circle, .node ellipse, .node path, .cluster rect,
          .classGroup rect, .actor { stroke-width: 1px !important; }
          .node rect, .cluster rect, .statediagram-state rect, .actor { rx: ${r}px; ry: ${r}px; }
          .flowchart-link, .transition, .relation { stroke-width: 1px !important; stroke-linecap: round; }
          .edgeLabel, .edgeLabel p, .edgeLabel span { color: ${p.muted} !important; font-size: 13px; }
          .edgeLabel rect, .labelBkg { fill: ${p.bg} !important; background-color: ${p.bg} !important; }
          .cluster rect { fill: ${p.surfaceAlt} !important; fill-opacity: 0.35; }
          .cluster-label span, .cluster-label p { color: ${p.muted}; }`,
      };
    },
  },
};

export const DEFAULT_THEME = 'wermaid';

const BUILT_IN = new Set(Object.keys(THEMES));
const NAME_RE = /^[a-z][a-z0-9-]*$/;
export const THEME_NAME_RE = NAME_RE;
const EDGE_LOOKS = ['rounded', 'orthogonal', 'curved', 'mermaid'];

/** The registered theme called `name`, or null. */
export function getTheme(name) {
  return typeof name === 'string' && Object.hasOwn(THEMES, name) ? THEMES[name] : null;
}

/** Every registered theme, built-ins first, then custom ones in the order they were defined. */
export function listThemes() {
  return Object.entries(THEMES).map(([name, t]) => ({ name, label: t.label }));
}

/** `theme: NO_THEME` asks for no palette at all: Mermaid's own config is left alone. */
export const NO_THEME = 'none';

/**
 * Which theme a diagram draws with. `theme` forces one (NO_THEME: none at all), else the block's
 * `@theme`, else the `defaults` (a name or a list, tried in order). Names that aren't registered
 * are skipped and listed in `unknown`; when only unknown names were given, the result is wermaid.
 * Returns { name, unknown }, where name is null when nothing asks for a theme.
 */
export function resolveTheme({ theme, block, defaults } = {}) {
  if (theme === NO_THEME) return { name: null, unknown: [] };
  const unknown = [];
  for (const name of [theme, block, ...[defaults].flat()]) {
    if (name == null || name === '') continue;
    if (getTheme(name)) return { name, unknown };
    if (!unknown.includes(name)) unknown.push(name);
  }
  return { name: unknown.length ? DEFAULT_THEME : null, unknown };
}

const listeners = new Set();

/**
 * Call `fn(name)` whenever defineTheme defines or redefines a theme, so diagrams and pickers
 * already on the page can catch up. Returns a function that stops the calls.
 */
export function onThemesChange(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/* ---------- colours ---------- */

function parseColor(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((x) => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

function toHex({ r, g, b, a = 1 }) {
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ''}`;
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
}

function luminance(c) {
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * A light colour's dark counterpart: same hue and saturation, lightness flipped and kept
 * off the extremes (L' = 0.06 + 0.88 × (1 − L)), so white becomes a near-black and
 * near-black text becomes a soft near-white. Colours that aren't hex or rgb() are kept as given.
 */
function darken(v) {
  const c = parseColor(v);
  if (!c) return v;
  const hsl = rgbToHsl(c);
  return toHex({ ...hslToRgb({ ...hsl, l: 0.06 + 0.88 * (1 - hsl.l) }), a: c.a });
}

const WHITE = { r: 255, g: 255, b: 255 }, BLACK = { r: 0, g: 0, b: 0 };

/** Whether a colour reads as light: black text on it has more contrast than white (luminance > ~0.18). */
function isLight(c) {
  return contrast(c, BLACK) > contrast(c, WHITE);
}

/**
 * Move `fg`'s lightness (same hue) away from `bg` until it reaches `target` contrast:
 * darker on a light background, lighter on a dark one; black or white if it never does.
 */
function keepContrast(fg, bg, target) {
  const f = parseColor(fg), b = parseColor(bg);
  if (!f || !b || contrast(f, b) >= target) return fg;
  const up = !isLight(b), hsl = rgbToHsl(f);
  for (let i = 0; i <= 100; i++) {
    const l = Math.max(0, Math.min(1, hsl.l + (up ? i : -i) / 100));
    const c = { ...hslToRgb({ ...hsl, l }), a: f.a };
    if (contrast(c, b) >= target) return toHex(c);
    if (l === 0 || l === 1) break;
  }
  return up ? '#ffffff' : '#000000';
}

/* ---------- specs ---------- */

const COLOR_KEYS = ['background', 'text', 'muted', 'line', 'nodeFill', 'nodeBorder', 'groupFill', 'groupBorder', 'labelBackground'];
const SURFACE_KEYS = ['nodeFill', 'groupFill', 'labelBackground'];
const GROUPS = ['font', 'shapes', 'edges', 'spacing'];

/** Built-ins as specs, for themes that extend them. Their own drawing stays hand-written above. */
const BUILT_IN_SPECS = {
  wermaid: {
    label: 'Wermaid',
    font: { family: MONO, size: 13, weight: 400, stylesheet: null },
    colors: {
      background: WERMAID.light.bg, text: WERMAID.light.fg, muted: WERMAID.light.muted, line: WERMAID.light.line,
      nodeFill: WERMAID.light.fill, nodeBorder: WERMAID.light.border, groupFill: WERMAID.light.cluster,
      groupBorder: WERMAID.light.clusterBorder, labelBackground: WERMAID.light.bg,
    },
    shapes: { radius: 0, borderWidth: 1 },
    edges: { style: 'mermaid', radius: 6, width: 1 },
    spacing: { node: 56, rank: 56, padding: 14 },
    dark: {
      colors: {
        background: WERMAID.dark.bg, text: WERMAID.dark.fg, muted: WERMAID.dark.muted, line: WERMAID.dark.line,
        nodeFill: WERMAID.dark.fill, nodeBorder: WERMAID.dark.border, groupFill: WERMAID.dark.cluster,
        groupBorder: WERMAID.dark.clusterBorder, labelBackground: WERMAID.dark.bg,
      },
    },
    fonts: THEMES.wermaid.fonts,
  },
  pele: {
    label: 'Pele',
    font: { family: SANS, size: 14, weight: 400, stylesheet: null },
    // Pele's own groups are surfaceAlt at 35% over the background; flattened here.
    colors: {
      background: PELE.light.bg, text: PELE.light.fg, muted: PELE.light.muted, line: PELE.light.line,
      nodeFill: PELE.light.surface, nodeBorder: PELE.light.border, groupFill: '#f6f4e8',
      groupBorder: PELE.light.border, labelBackground: PELE.light.bg,
    },
    shapes: { radius: PELE.light.radius, borderWidth: 1 },
    edges: { style: 'mermaid', radius: 6, width: 1 },
    spacing: { node: 48, rank: 52, padding: 16 },
    dark: {
      colors: {
        background: PELE.dark.bg, text: PELE.dark.fg, muted: PELE.dark.muted, line: PELE.dark.line,
        nodeFill: PELE.dark.surface, nodeBorder: PELE.dark.border, groupFill: '#181717',
        groupBorder: PELE.dark.border, labelBackground: PELE.dark.bg,
      },
    },
    credit: THEMES.pele.credit,
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const defined = (o) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([, v]) => v !== undefined && v !== null));

/**
 * Merge `spec` over the resolved `parent`.
 *
 * Light: surfaces (node fill, group fill, label background) the child leaves alone that were the
 * parent's background follow the child's background, so "no fill" stays no fill.
 *
 * Dark: `dark.colors` wins. A colour the child (or its new background) changed gets a fresh dark
 * counterpart from `darken()`; one it left alone keeps the parent's dark colour, unless the dark
 * background ended up on the other side of light/dark from the parent's, in which case every
 * colour is re-derived. Text, muted and line keep at least the contrast they had in light mode
 * (capped at 7 for text, 4.5 for the others); derived surfaces stay on the background's side.
 */
function resolveSpec(parent, spec) {
  const out = { label: spec.label ?? parent.label, dark: { colors: {} }, fonts: parent.fonts, credit: parent.credit };
  for (const g of GROUPS) out[g] = { ...parent[g], ...defined(spec[g]) };
  const own = defined(spec.colors), ownDark = defined(spec.dark?.colors);
  out.colors = { ...parent.colors, ...own };
  const changed = new Set(Object.keys(own));
  if ('background' in own) {
    for (const k of SURFACE_KEYS) {
      if (!(k in own) && parent.colors[k] === parent.colors.background) { out.colors[k] = own.background; changed.add(k); }
    }
  }
  const bgDark = ownDark.background ?? (changed.has('background') ? darken(out.colors.background) : parent.dark.colors.background);
  const pb = parseColor(bgDark), pp = parseColor(parent.dark.colors.background);
  const flipped = !!(pb && pp) && isLight(pb) !== isLight(pp);
  for (const k of COLOR_KEYS) {
    out.dark.colors[k] = ownDark[k] ?? (changed.has(k) || flipped ? undefined : parent.dark.colors[k]);
  }
  out.dark.colors.background = bgDark;
  const lb = parseColor(out.colors.background), db = parseColor(bgDark);
  for (const k of COLOR_KEYS) {
    if (out.dark.colors[k] !== undefined) continue;
    let v = darken(out.colors[k]);
    if (['text', 'muted', 'line'].includes(k)) {
      const lf = parseColor(out.colors[k]);
      const target = lf && lb ? Math.min(contrast(lf, lb), k === 'text' ? 7 : 4.5) : 4.5;
      v = keepContrast(v, bgDark, target);
    } else if (SURFACE_KEYS.includes(k)) {
      const c = parseColor(v);
      if (c && db && isLight(c) !== isLight(db)) v = bgDark;
    }
    out.dark.colors[k] = v;
  }
  for (const g of GROUPS) {
    const d = { ...defined(parent.dark[g]), ...defined(spec.dark?.[g]) };
    if (Object.keys(d).length) out.dark[g] = d;
  }
  // Fonts to wait for: the parent's unless the family, size or weight changed.
  if (spec.font && ['family', 'size', 'weight'].some((k) => spec.font[k] != null)) {
    const { family, weight } = out.font, size = parseFloat(out.font.size) || 13;
    out.fonts = [`${weight} ${size}px ${family}`, `500 ${size}px ${family}`];
  }
  return out;
}

function compile(spec, warnings) {
  const variant = (dark) => {
    const font = { ...spec.font, ...(dark && spec.dark.font) };
    const shapes = { ...spec.shapes, ...(dark && spec.dark.shapes) };
    const edges = { ...spec.edges, ...(dark && spec.dark.edges) };
    const spacing = { ...spec.spacing, ...(dark && spec.dark.spacing) };
    const k = dark ? spec.dark.colors : spec.colors;
    return { font, shapes, edges, spacing, k };
  };
  const style = spec.edges.style;
  return {
    label: spec.label,
    fonts: spec.fonts,
    ...(spec.credit && { credit: spec.credit }),
    edges: style && style !== 'mermaid' ? { style, radius: spec.edges.radius ?? 6 } : null,
    stylesheet: spec.font.stylesheet || null,
    warnings,
    spec,
    background: (dark) => (dark ? spec.dark.colors : spec.colors).background,
    config: ({ dark }) => {
      const { font, shapes, edges, spacing, k } = variant(!!dark);
      const c = {
        bg: k.background, fg: k.text, muted: k.muted, line: k.line, fill: k.nodeFill, border: k.nodeBorder,
        cluster: k.groupFill, clusterBorder: k.groupBorder, labelBg: k.labelBackground,
      };
      const num = (v, fallback) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : fallback);
      const size = num(font.size, 13), r = num(shapes.radius, 0);
      return {
        theme: 'base', fontFamily: font.family,
        flowchart: { htmlLabels: true, padding: spacing.padding, nodeSpacing: spacing.node, rankSpacing: spacing.rank },
        themeVariables: baseVariables(c, font.family, `${size}px`, !!dark),
        themeCSS: `
          .node rect, .node polygon, .node circle, .node ellipse, .node path, .cluster rect,
          .statediagram-cluster rect, .classGroup rect, .divider, .actor { stroke-width: ${num(shapes.borderWidth, 1)}px !important; }
          ${r ? `.node rect, .cluster rect, .statediagram-state rect, .actor { rx: ${r}px; ry: ${r}px; }` : ''}
          .flowchart-link, .transition, .relation { stroke-width: ${num(edges.width, 1)}px !important; }
          .nodeLabel, .node .label { font-weight: ${font.weight}; }
          .edgeLabel, .edgeLabel p, .edgeLabel span { color: ${c.muted} !important; font-size: ${size - 1}px; }
          .edgeLabel rect, .labelBkg { fill: ${c.labelBg} !important; background-color: ${c.labelBg} !important; }
          .cluster-label span, .cluster-label p { color: ${c.fg}; font-weight: 500; }`,
      };
    },
  };
}

/**
 * Register a theme for every diagram on the page.
 *
 *   defineTheme('acme', {
 *     label: 'Acme', extends: 'wermaid',
 *     font: { family, size, weight, stylesheet },
 *     colors: { background, text, muted, line, nodeFill, nodeBorder, groupFill, groupBorder, labelBackground },
 *     shapes: { radius, borderWidth },
 *     edges: { style: 'rounded' | 'orthogonal' | 'curved' | 'mermaid', radius, width },
 *     spacing: { node, rank, padding },
 *     dark: { colors: { … }, font, shapes, edges, spacing },
 *   });
 *
 * Every field is optional; missing ones come from `extends` (a built-in or an earlier custom
 * theme, resolved now), else `wermaid`. `extends: 'mermaid'` falls back to `wermaid` with a
 * warning shown on diagrams that use the theme. A dark colour left out is derived from its
 * light colour. Built-in names can't be redefined; custom ones can. Diagrams already drawn
 * with the theme (or waiting for it) pick up the new definition (see onThemesChange).
 */
export function defineTheme(name, spec = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new TypeError(`Theme names are lowercase letters, digits and dashes, starting with a letter — got "${name}"`);
  if (BUILT_IN.has(name)) throw new TypeError(`"${name}" is a built-in theme and can't be redefined`);
  if (!isObj(spec)) throw new TypeError('defineTheme expects a spec object');
  const style = spec.edges?.style;
  if (style != null && !EDGE_LOOKS.includes(style)) throw new TypeError(`edges.style expects ${EDGE_LOOKS.join(', ')} — got "${style}"`);
  const warnings = [];
  let parent = BUILT_IN_SPECS.wermaid;
  if (spec.extends != null) {
    if (spec.extends === 'mermaid') {
      warnings.push(`Theme "${name}" extends mermaid, which can't be extended; it extends wermaid instead.`);
    } else if (Object.hasOwn(BUILT_IN_SPECS, spec.extends)) {
      parent = BUILT_IN_SPECS[spec.extends];
    } else if (getTheme(spec.extends)?.spec) {
      parent = getTheme(spec.extends).spec;
      warnings.push(...getTheme(spec.extends).warnings);
    } else {
      warnings.push(`Theme "${name}" extends "${spec.extends}", which isn't defined; it extends wermaid instead.`);
    }
  }
  const resolved = resolveSpec(parent, spec);
  resolved.label = spec.label ?? name;
  THEMES[name] = compile(resolved, warnings);
  // A listener that throws doesn't stop the others, or fail the definition.
  for (const fn of [...listeners]) {
    try { fn(name); } catch (err) { queueMicrotask(() => { throw err; }); }
  }
}

/**
 * Put a palette's config in front of the diagram as an init directive
 * (after any front matter, which Mermaid only reads at the very top).
 */
export function withTheme(body, name, { dark = false, el = null } = {}) {
  const theme = getTheme(name);
  if (!theme) return body;
  // Mermaid turns every ' in a directive into " before parsing it as JSON, so a value such as
  // `'Courier New', monospace` would break the JSON and drop the whole theme. JSON's '
  // escape has no quote for Mermaid to swap and still parses back to '.
  const json = JSON.stringify(theme.config({ dark, el })).replace(/'/g, '\\u0027');
  const directive = `%%{init: ${json}}%%`;
  const fm = body.match(/^\s*---\n[\s\S]*?\n---\s*\n/);
  return fm ? `${fm[0]}${directive}\n${body.slice(fm[0].length)}` : `${directive}\n${body}`;
}
