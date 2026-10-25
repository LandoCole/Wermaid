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
| `pele` | The look of [Pele](https://pele.run): filled, rounded nodes in Flexoki colours with a system sans. If the page defines Pele's `--pele-*` CSS variables, those win, so an existing Pele skin carries over. |

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
- The diagram sits on an open canvas: press and hold the background (or the middle mouse button anywhere)
  to pan in any direction; scroll or two-finger swipe also pans; pinch or Ctrl/⌘ + scroll zooms at the
  pointer; Fit centres the diagram. On touch screens, one finger pans and two pinch.
- Arrow keys nudge, Delete resets the selection, Ctrl/⌘ Z undoes.
- "Edges" in the diagram header sets the look for every edge; a selected edge has its own style picker.
- "Palette" switches between Mermaid, Wermaid and Pele, and follows the page's light/dark mode.
- "Stock" shows Mermaid's own layout for comparison.

Diagrams render with Mermaid's `base` theme driven by the page's color tokens: thin outlines,
IBM Plex Mono, no fills. The page pairs that with a serif title face; it lists Michelangelus
first and falls back to EB Garamond.

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
- `src/editor.html` – editor template; `src/examples.mjs` – the bundled examples
- `test/m1.html` – library suite: stock-identical render, local effect, subgraph refit, stale ids,
  round trip, obstacle avoidance
- `test/interact.mjs` – editor suite: nudge/pin, resize, bends, labels, undo, examples

## Known limits

- Edges with manual bends (`via`) go straight through the bends you set and don't avoid shapes.
- Subgraph frames aren't obstacles: routes may cross a subgraph they don't belong to.
- Class diagram cardinality labels ("1", "*") stay where Mermaid put them when an edge moves.
- Overrides are applied after Mermaid's layout, so the rest of the diagram doesn't make room for
  a moved shape.
