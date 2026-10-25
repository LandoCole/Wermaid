<p><img src="assets/wermaid-logo.svg" alt="Wermaid" width="300" height="64"></p>

# Wermaid

Manual layout overrides for vanilla Mermaid. Mermaid still parses and lays out the diagram;
Wermaid applies the adjustments saved in a `%% @layout` block and re-routes only what moved.

The block is made of Mermaid comments, so GitHub, Notion and every other Mermaid renderer
ignore it and draw the stock layout.

## Layout block

```
flowchart LR
  A[Start] --> B{Check}
  B -->|yes| C
  B e1@-->|no| D

%% @layout v1
%% @title Checkout flow          (the diagram's name: names exported files)
%% @theme pele                  (palette: mermaid, wermaid or pele)
%% @edges rounded               (draw every edge square-routed with rounded corners)
%% B        nudge 0,40            (offset from where Mermaid puts it)
%% C        at 320,200            (pin the center, diagram units)
%% D        size 160x60
%% G1       nudge 80,0            (subgraph: moves everything inside it)
%% A->B     via 260,140 260,200   (edge bends; A->B#2 for the second A→B edge)
%% edge e1  label 0,-12 ; style orthogonal   (edge by Mermaid edge id)
%% @end
```

| Instruction | Applies to | Meaning |
|---|---|---|
| `nudge dx,dy` | node, subgraph | Offset from the auto layout. Follows the layout when the source changes. |
| `at x,y` | node, subgraph | Pin the center at fixed coordinates, whatever the layout does. |
| `size WxH` | node | Draw the shape at this size |
| `via x,y …` | edge | Route the edge through these points |
| `label dx,dy` | edge | Offset the label from its automatic spot |
| `style rounded \| orthogonal \| curved` | edge | Draw this edge in a different look |

### Palettes

`%% @theme <name>` picks a palette. It's applied to that one diagram as a Mermaid init
directive, so it never changes the page's global Mermaid config.

| Palette | Look |
|---|---|
| `mermaid` | Mermaid's own black-and-white theme (`neutral`, and `dark` in dark mode) |
| `wermaid` | Thin outlines, IBM Plex Mono, no fills (the editor's default) |
| `pele` | The look of [Pele](https://pele.run) by [Steph Ango](https://stephango.com) (see [Thanks](#thanks)): filled, rounded nodes in [Flexoki](https://stephango.com/flexoki) colours with a system sans. If the page defines Pele's `--pele-*` CSS variables, those win, so an existing Pele skin carries over. |

Pele is its own renderer with its own layout; Wermaid borrows its skin, not its engine,
because the layout block is anchored to Mermaid's layout. Every palette has a light and a dark
variant; pass `dark: true` to `render()` for the dark one. Palettes change fonts and spacing,
so Mermaid's auto layout shifts a little between them: `nudge` offsets follow along, `at` pins
don't.

New palettes live in `src/themes.js`: each one returns a Mermaid config (`theme`,
`themeVariables`, `themeCSS`, layout spacing) for light or dark.

### Edge looks

`%% @edges <look> [radius]` sets how edges are drawn for the whole diagram; `style` on one edge
overrides it.

| Look | Edges |
|---|---|
| (no setting) | Untouched edges keep Mermaid's curves; edges Wermaid re-routes are square with rounded corners |
| `rounded` | Every edge routed around shapes on right angles, corners rounded (radius 6, or the number given) |
| `orthogonal` | Same routes with sharp corners |
| `curved` | Untouched edges keep Mermaid's curves; re-routed edges are smoothed into curves too |

`rounded` and `orthogonal` re-route every edge, so an untouched diagram no longer matches the
stock render exactly. Edges with bends (`via`) follow right angles through the bends in these
two looks.

Overrides only move the shapes they name; every other shape stays where Mermaid put it.
A subgraph's offset also applies to everything inside it. Overrides naming ids that no longer
exist produce warnings and are ignored.

## Editor

`dist/editor.html` is a single-file editor (Mermaid loads from jsDelivr).

- Drag a shape to **nudge** it. Alt-drag **pins** it with `at`. "Pin here" / "Unpin" in the
  selection bar converts between the two without moving the shape.
- Drag a corner to resize, a line to add a bend (double-click a bend to remove it), an edge label
  to offset it, a subgraph's frame to move everything inside.
- The diagram sits on a canvas a little larger than itself: press and hold the background (or the middle
  mouse button anywhere) to pan in any direction; scroll or two-finger swipe also pans; pinch or Ctrl/⌘ + scroll zooms at the
  pointer; Fit centres the diagram. On touch screens, one finger pans and two pinch.
  Panning stops at the canvas edge, so the diagram can't be lost: one that fits stays in view, and a
  bigger one can be panned until at most a quarter of the viewport is empty past its edge.
- Arrow keys nudge, Delete resets the selection, Ctrl/⌘ Z undoes.
- Click the title to rename the diagram (Enter saves, Escape cancels, empty goes back to the example's
  name). A diagram that isn't an untouched example, including one typed into a cleared source, is
  called `my-wermaid` until renamed. The name is stored as `%% @title` in the layout block and names exported files.
- "Edges" in the diagram header sets the look for every edge; a selected edge has its own style picker.
- "Palette" switches between Mermaid, Wermaid and Pele, and follows the page's light/dark mode.
- "Export" copies the diagram as PNG or SVG, or saves it as PNG (2x), SVG, or Markdown (the source
  in a ```mermaid fence, layout block included, ready for a README). Inside Claude, saving goes
  through the viewer's save prompt.
- "Stock" shows Mermaid's own layout for comparison.

Diagrams render with Mermaid's `base` theme driven by the page's color tokens: thin outlines,
IBM Plex Mono, no fills. The page pairs that with a serif title face; it lists Michelangelus
first and falls back to EB Garamond.

## Embedding

`src/element.js` renders Wermaid diagrams in any page: a `<wermaid-diagram>` element, and a
`run()` that upgrades the Mermaid blocks a page already has. `dist/embed-demo.html` shows both.

```html
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs';
  import { defineWermaidElement, run } from 'https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@main/src/element.js';

  defineWermaidElement(mermaid);   // registers <wermaid-diagram>
  run();                           // renders pre.mermaid and ```mermaid blocks with their layout blocks
</script>

<wermaid-diagram pannable controls height="420">
  flowchart LR
    A[Start] --> B{Check}
    B -->|yes| C[Ship]
  %% @layout v1
  %% C  nudge 0,40
  %% @end
</wermaid-diagram>
```

With npm: `import { defineWermaidElement, run } from 'wermaid/element'`.

| Attribute | Values | |
|---|---|---|
| `theme` | `mermaid`, `wermaid`, `pele`, `none` | Palette. Default: the block's `@theme`, else `wermaid`. `none` leaves the page's Mermaid config alone. |
| `dark` | `auto`, `true`, `false` | `auto` (default) follows `prefers-color-scheme` and re-renders when it changes. |
| `pannable` | present | A fixed-height canvas: drag to pan, pinch or Ctrl/⌘ + scroll to zoom, double-click to fit. Panning stops at the canvas edge (as in the editor). Plain scrolling still scrolls the page. |
| `controls` | present | Toolbar with zoom and Fit (when pannable) and Export: copy or save PNG/SVG. |
| `height` | CSS length or px number | Canvas height when pannable (default 420px). |
| `background` | `palette`, `none`, a colour | Fill behind the diagram. Default `none` inline, `palette` when pannable. |
| `src` | URL | Load the source from a `.mmd` / text file instead of the element's text. |
| `name` | text | File name for exports. Default: the block's `@title`, else `my-wermaid`. |

The source can be the element's text (indented freely, `<br/>` and entities work as in
Mermaid), the `source` property, or `src`. Changing any of them re-renders.

```js
const el = document.querySelector('wermaid-diagram');
await el.rendered;                 // promise for the latest render
el.diagram;                        // the library's diagram object (geometry, toSVG(), toPNG(), …)
el.fit();                          // re-centre a pannable viewer
el.addEventListener('wermaid:render', (e) => e.detail.diagram);
el.addEventListener('wermaid:error', (e) => e.detail.error);   // also shown in place of the diagram
```

`run({ root, selector, attributes })` replaces each match of `pre.mermaid, pre.wermaid,
pre > code.language-mermaid, pre > code.language-wermaid` (the last two are what Markdown
renderers emit for fenced blocks) with a `<wermaid-diagram>`, copying `data-theme`, `data-dark`,
`data-pannable`, `data-controls`, `data-height` and `data-background` across. `attributes`
sets defaults for every block, e.g. `run({ attributes: { controls: '' } })`. It returns a
promise that settles when every diagram has rendered.

Notes:

- `defineWermaidElement(mermaid, { tag, fonts, config })` calls `mermaid.initialize` with
  `startOnLoad: false` (so Mermaid doesn't also render the blocks) and `securityLevel: 'strict'`;
  pass `config` to add to that. `fonts: false` stops it adding the IBM Plex Mono stylesheet the
  Wermaid palette uses.
- Diagrams render in shadow DOM, so page CSS doesn't leak in. A diagram inside something hidden
  (a closed tab, `display: none`) waits until it's visible, since Mermaid needs real text sizes.
- Exports leave out the toolbar; inside Claude artifacts, saving goes through the viewer's save prompt.

## Library

```js
import mermaid from 'mermaid';               // v11+
import { createWermaid } from 'wermaid';

const wermaid = createWermaid(mermaid);
const diagram = await wermaid.render(container, source, { theme: 'pele', dark: false });
diagram.geometry;                 // final node/subgraph boxes and edge points
diagram.setOverrides(next);       // re-apply without re-running Mermaid
diagram.showStock();              // Mermaid's own layout
diagram.writeSource(source);      // source with the layout block rewritten
diagram.toSVG();                  // standalone SVG text
await diagram.toPNG({ scale: 2 }); // PNG Blob
```

How it works (Mermaid 11.16): Mermaid's dagre layout computes positions and draws in a single
function, with no public hook in between. So the adapter reads the finished layout instead:
structure from `getDiagramFromText(...).db.getData()` (ids, parents, edges) and geometry from
the rendered SVG (`data-points` on edges, node transforms, cluster frames). Every change is a
recorded attribute mutation, so the stock render can be restored exactly.

Edges are re-routed when their ends move apart, when a shape is resized, or when a moved shape
lands on them. The router follows libavoid's approach for orthogonal connectors: a visibility
graph around the shapes, a shortest path that penalises bends, ports spread along shared sides,
and nudging that separates overlapping segments.

Supported: flowchart, state, class (anything using Mermaid's unified renderer).
Other types (sequence, gantt, …) render as stock Mermaid.

## Logo

`assets/wermaid-mark.svg` is the mark: one routed connector, from a start node to an arrowhead,
drawn as a W. `assets/wermaid-icon.svg` is the favicon cut (no node, heavier line), and
`assets/wermaid-logo.svg` pairs the mark with the serif wordmark. All three switch to light
strokes in dark mode.

The name: Wermaid is Mermaid with its M flipped over into a W.

## Thanks

The `pele` palette is a thank-you to **[Pele](https://pele.run)**, the Mermaid renderer by
**[Steph Ango](https://stephango.com)** ([@kepano](https://github.com/kepano)), made for Obsidian:
[github.com/obsidianmd/pele](https://github.com/obsidianmd/pele) (MIT). Its clean, filled look
showed how good a Mermaid diagram can be, and its colours are
[Flexoki](https://stephango.com/flexoki), also by Steph. Thank you, Steph.

Wermaid borrows Pele's look, not its code: the palette is re-expressed as a Mermaid theme, and
Wermaid reads Pele's `--pele-*` CSS variables so an existing Pele skin carries over. Pele is a
separate renderer with its own layout; use it directly if you want Pele itself. The editor and the
embed demo credit Pele whenever its palette is shown.

Diagrams are parsed, laid out and drawn by [Mermaid](https://mermaid.js.org); Wermaid only adjusts
what Mermaid produces. The editor's type is [IBM Plex Mono](https://github.com/IBM/plex).

## Development

```
npm install
npm run link-mermaid      # serves node_modules/mermaid/dist at /mermaid-dist for tests
npm run build             # inlines src/themes.js, src/wermaid.js and src/examples.mjs into dist/editor.html
npm run serve &           # http://127.0.0.1:8765/dist/local.html?mermaid=/mermaid-dist/mermaid.esm.min.mjs
npx playwright install chromium
npm test
```

- `src/wermaid.js` – the library (no dependencies besides the Mermaid instance you pass in)
- `src/themes.js` – palettes
- `src/element.js` – `<wermaid-diagram>` and `run()`
- `src/editor.html` – editor template; `src/examples.mjs` – the bundled examples
- `src/embed-demo.html` – embedding demo template (built to `dist/embed-demo.html`)
- `test/m1.html` – library suite: stock-identical render, local effect, subgraph refit, stale ids,
  round trip, obstacle avoidance
- `test/interact.mjs` – editor suite: nudge/pin, resize, bends, labels, undo, examples
- `test/export.mjs` – PNG/SVG export; `test/embed.mjs` – element and `run()` suite

## Known limits

- Edges with manual bends (`via`) go straight through the bends you set and don't avoid shapes.
- Subgraph frames aren't obstacles: routes may cross a subgraph they don't belong to.
- Class diagram cardinality labels ("1", "*") stay where Mermaid put them when an edge moves.
- Overrides are applied after Mermaid's layout, so the rest of the diagram doesn't make room for
  a moved shape.
