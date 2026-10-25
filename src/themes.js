/*
 * Wermaid palettes: named looks for diagrams, applied per diagram as a Mermaid
 * `%%{init}%%` directive so they never touch the page's global Mermaid config.
 *
 *   mermaid  Mermaid's own black-and-white theme (`neutral`; `dark` in dark mode)
 *   wermaid  thin outlines, IBM Plex Mono, no fills
 *   pele     the look of Pele (pele.run): filled rounded nodes, Flexoki colours,
 *            system sans. Reads `--pele-*` CSS variables from the page when set,
 *            so an existing Pele skin carries over.
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
    lineColor: c.line, clusterBkg: c.cluster, clusterBorder: c.clusterBorder, edgeLabelBackground: c.bg,
    classText: c.fg, labelBackgroundColor: c.bg,
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
    background: (dark) => (dark ? '#333333' : '#ffffff'),
    config: ({ dark }) => ({ theme: dark ? 'dark' : 'neutral' }),
  },
  wermaid: {
    label: 'Wermaid',
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

/**
 * Put a palette's config in front of the diagram as an init directive
 * (after any front matter, which Mermaid only reads at the very top).
 */
export function withTheme(body, name, { dark = false, el = null } = {}) {
  const theme = THEMES[name];
  if (!theme) return body;
  const directive = `%%{init: ${JSON.stringify(theme.config({ dark, el }))}}%%`;
  const fm = body.match(/^\s*---\n[\s\S]*?\n---\s*\n/);
  return fm ? `${fm[0]}${directive}\n${body.slice(fm[0].length)}` : `${directive}\n${body}`;
}
