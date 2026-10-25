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
%% @theme pele                  (a theme: mermaid, wermaid, pele, or one you define)
%% @edges rounded               (rounded | orthogonal | curved | mermaid, optional radius)
%% B        nudge 0,40            (offset from where Mermaid puts it)
%% C        at 320,200            (pin the center, diagram units)
%% D        size 160x60
%% G1       nudge 80,0            (subgraph: moves everything inside it)
%% G2       size 900x150          (subgraph: a frame of exactly this size)
%% A->B     via 260,140 260,200   (edge bends; A->B#2 for the second A→B edge)
%% edge e1  label 0,-12 ; style orthogonal   (edge by Mermaid edge id)
%% @end
```

| Instruction | Applies to | Meaning |
|---|---|---|
| `nudge dx,dy` | node, subgraph | Offset from the auto layout. Follows the layout when the source changes. |
| `at x,y` | node, subgraph | Pin the center at fixed coordinates, whatever the layout does. |
| `size WxH` | node, subgraph | Draw the shape at this size. A subgraph's frame is centred on what's inside it and never drawn smaller than its contents, so frames given one size line up as equal lanes. |
| `via x,y …` | edge | Route the edge through these points |
| `label dx,dy` | edge | Offset the label from its automatic spot |
| `style rounded \| orthogonal \| curved` | edge | Draw this edge in a different look |

### Themes

`%% @theme <name>` picks a theme. It's applied to that one diagram as a Mermaid init
directive, so it never changes the page's global Mermaid config.

| Theme | Look |
|---|---|
| `mermaid` | Mermaid's own black-and-white theme (`neutral`, and `dark` in dark mode) |
| `wermaid` | Thin outlines, IBM Plex Mono, no fills (the editor's default) |
| `pele` | Filled, rounded nodes in Flexoki colours with a system sans. If the page defines Pele's `--pele-*` CSS variables, those win, so an existing Pele skin carries over. |

The `pele` theme is a thank-you to [Pele](https://pele.run), the Mermaid renderer by
Steph Ango ([@kepano](https://github.com/kepano)), and uses kepano's
[Flexoki](https://stephango.com/flexoki) colours.

Pele is its own renderer with its own layout. For now Wermaid borrows only its look: the
`pele` theme is still drawn by Mermaid, and the layout block is anchored to Mermaid's layout.
We plan to add Pele's renderer as an optional engine in a future release (early work is on
the [`pele-engine-spike`](https://github.com/LandoCole/Wermaid/tree/pele-engine-spike) branch).
Pele lays diagrams out differently, so overrides saved against Mermaid's layout won't line up
when a diagram is drawn by Pele.

Every theme has a light and a dark variant; pass `dark: true` to `render()` for the dark one
(`<wermaid-diagram>` follows the page). Themes change fonts and spacing, so Mermaid's auto layout
shifts a little between them: `nudge` offsets follow along, `at` pins don't.

A diagram that names a theme the page hasn't defined draws in the default theme and carries a
warning (`diagram.warnings`, and the editor shows it). It never fails to render.

#### Your own themes

`defineTheme(name, spec)` registers a theme for every diagram on the page. A registered theme
works like the built-in ones: by name in `%% @theme`, in the `theme` attribute, in pickers.

```js
import { defineTheme } from 'https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@v0.4.0/src/wermaid.js';

defineTheme('acme', {
  label: 'Acme',
  extends: 'wermaid',
  font: { family: '"Inter", system-ui, sans-serif', size: 14, weight: 400,
          stylesheet: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap' },
  colors: {
    background: '#ffffff', text: '#1b1b1f', muted: '#6b6b73', line: '#1b1b1f',
    nodeFill: '#f4f4f6', nodeBorder: '#c9c9d1',
    groupFill: '#fafafa', groupBorder: '#dedee4', labelBackground: '#ffffff',
  },
  shapes: { radius: 6, borderWidth: 1 },
  edges: { style: 'rounded', radius: 6, width: 1 },
  spacing: { node: 56, rank: 56, padding: 14 },
  dark: { colors: { background: '#111114', text: '#ececf1' } },
});
```

The spec is plain data, so it can live in a JSON file:
`defineTheme('acme', await (await fetch('/acme-theme.json')).json())`. Diagrams already on the
page catch up when it arrives: those that use `acme` (or a redefined theme) draw again with it, and
theme pickers list it.

| Field | Meaning |
|---|---|
| `label` | Name shown in theme pickers. Default: the theme's name. |
| `extends` | `wermaid`, `pele`, or a custom theme defined earlier. Everything you leave out comes from it. Default `wermaid`. `mermaid` can't be extended (it's Mermaid's own theme, not a set of values): it falls back to `wermaid` with a warning. |
| `font` | `family`, `size` (px), `weight`, `stylesheet` (a URL, loaded once when a diagram first uses the theme; a theme without one just names a font the page already has). |
| `colors` | `background`, `text`, `muted` (edge labels), `line`, `nodeFill`, `nodeBorder`, `groupFill`, `groupBorder`, `labelBackground`. Hex or `rgb()` values, so the dark variant can be derived. |
| `shapes` | `radius` (corner rounding), `borderWidth`. |
| `edges` | `style`: `rounded`, `orthogonal`, `curved` or `mermaid` (Mermaid's own curves, which is what the built-in themes use); `radius` (bend radius); `width` (line thickness). |
| `spacing` | `node`, `rank`, `padding`: Mermaid's layout spacing. This moves Mermaid's auto layout, so `nudge` offsets shift with it. |
| `dark` | Overrides for dark mode: `colors`, and optionally `font`, `shapes`, `edges`, `spacing`. |

- Names are lowercase letters, digits and dashes, starting with a letter. Built-in names can't be
  redefined (`defineTheme` throws); a custom theme can be defined again to replace it.
- `extends` is resolved when `defineTheme` is called. Redefining the parent later doesn't update
  themes already built on it; define them again after it.
- A dark colour you leave out is worked out from the light one: same hue, lightness flipped, with
  text, muted text and lines keeping at least the contrast they have in light mode. Colours that
  aren't hex or `rgb()` are used as given in both modes. A surface (node fill, group fill, label
  background) that was the parent's background follows your `background`, so "no fill" stays no fill.
- `listThemes()` returns `[{ name, label }]` for building pickers. `defineTheme` and `listThemes`
  are exported from `wermaid.js` and re-exported from `element.js`, so a page that loads only the
  element can use them.
- The `--pele-*` CSS variables are read by the `pele` theme itself only. A theme that extends
  `pele` starts from Pele's published colours.
- Themes don't travel inside a diagram's source. A diagram saved with `%% @theme acme` draws in the
  default theme wherever `acme` isn't defined (GitHub, say).

#### Which theme a diagram uses

From strongest to weakest:

1. The diagram's own `%% @theme`. A user's pick in a theme picker is written here, so it travels
   with the saved source.
2. The element's `theme` attribute.
3. The page default: `defineWermaidElement(mermaid, { defaults: { theme: 'acme' } })`.
4. `wermaid`.

A name that isn't registered is skipped for the next level, with a warning. `theme="none"` on the
element beats all of these: no palette, Mermaid's own config, as in 0.3. The block's `%% @theme`
stays in the source (and in what the element writes back); it just isn't applied. With the library,
`render(…, { theme })` forces a theme over all of these (`theme: 'none'` forces none), and
`defaultTheme` (a name or a list) takes the place of levels 2 to 4.

The **theme builder** in the editor designs these specs against a real diagram (see Editor).

### Edge looks

`%% @edges <look> [radius]` sets how edges are drawn for the whole diagram; `style` on one edge
overrides it. A theme's `edges.style` is the starting look; `@edges` overrides the theme.

| Look | Edges |
|---|---|
| (no setting) | The theme's look. The built-in themes keep Mermaid's curves on untouched edges; edges Wermaid re-routes are square with rounded corners |
| `rounded` | Every edge routed around shapes on right angles, corners rounded (radius 6, or the number given) |
| `orthogonal` | Same routes with sharp corners |
| `curved` | Untouched edges keep Mermaid's curves; re-routed edges are smoothed into curves too |
| `mermaid` | Mermaid's own curves on untouched edges, even when the theme has a look of its own |

`mermaid` is for `@edges` only; a per-edge `style` takes `rounded`, `orthogonal` or `curved`.
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
- "Palette" switches between the built-in themes and any you've defined or built, and follows the
  page's light/dark mode.
- "Export" copies the diagram as PNG or SVG, or saves it as PNG (2x), SVG, or Markdown (the source
  in a ```mermaid fence, layout block included, ready for a README). Inside Claude, saving goes
  through the viewer's save prompt.
- "Stock" shows Mermaid's own layout for comparison.
- "Theme" opens the theme builder (below).

Diagrams render with Mermaid's `base` theme driven by the page's color tokens: thin outlines,
IBM Plex Mono, no fills. The page pairs that with a serif title face; it lists Michelangelus
first and falls back to EB Garamond.

### Theme builder

The "Theme" button opens a panel next to the diagram. Pick a theme to start from ("Start from" sets
`extends`) and change it: colours, font, corner rounding and border width, edge look, thickness
and bend radius, spacing. The diagram updates as you type. Light and dark sit side by side with a
switch that previews either; dark starts out derived from light, and a field you set replaces the
derived value. A field left empty shows what the theme will use as a placeholder.

- **Copy code** copies a `defineTheme('<name>', {…});` call to paste into your app. **Copy JSON**
  copies the same spec as JSON.
- **Import** reads a pasted spec (JSON or a `defineTheme(…)` call) so you can keep editing a theme.
- The theme appears in the Palette menu, so exports from the editor can use it. Themes you build
  are kept in your browser between visits.
- A spacing change moves Mermaid's layout, so nudged shapes move with it; the panel says so.

## Embedding

Wermaid loads straight from jsDelivr: no install, no build step. Pin to a release tag; `@main`
is the latest code but moves under you.

`src/element.js` renders Wermaid diagrams in any page: a `<wermaid-diagram>` element, and a
`run()` that upgrades the Mermaid blocks a page already has. `dist/embed-demo.html` shows both.

```html
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs';
  import { defineWermaidElement, run } from 'https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@v0.4.0/src/element.js';

  defineWermaidElement(mermaid);   // registers <wermaid-diagram>
  run();                           // renders pre.mermaid and ```mermaid blocks with their layout blocks
</script>

<wermaid-diagram features="copy download edit themes">
  flowchart LR
    A[Start] --> B{Check}
    B -->|yes| C[Ship]
  %% @layout v1
  %% C  nudge 0,40
  %% @end
</wermaid-diagram>
```

The source can be the element's text (indented freely, `<br/>` and entities work as in
Mermaid), the `source` property, or `src`. Changing any of them re-renders.

| Attribute | Values | |
|---|---|---|
| `theme` | `mermaid`, `wermaid`, `pele`, a theme you defined, `none` | The starting theme for diagrams that name none in their block (see "Which theme a diagram uses"). Default: the page default, else `wermaid`. `none` leaves the page's Mermaid config alone, even for a diagram whose block names a theme, and hides the theme picker. |
| `dark` | `auto`, `true`, `false` | `auto` (default) follows `prefers-color-scheme` and re-renders when it changes. |
| `features` | space-separated names, or `none` | What the viewer offers (below). Default `copy download`. |
| `formats` | `png`, `svg`, `md` | What Download offers (below). Default `png`. |
| `themes` | space-separated theme names | Limits the theme picker to these (registered ones). Default: every registered theme. |
| `pannable` | present | A fixed-height canvas: drag to pan, pinch or Ctrl/⌘ + scroll to zoom, double-click to fit. Panning stops at the canvas edge (as in the editor). Plain scrolling still scrolls the page. |
| `controls` | present | The classic toolbar: zoom and Fit (when pannable) and an Export menu to copy or save PNG/SVG, always shown. Shorthand for `features="zoom copy download" formats="png svg"`; if `features` is also set, `features` wins. |
| `height` | CSS length or px number | Canvas height when pannable (default 420px). |
| `background` | `palette`, `none`, a colour | Fill behind the diagram. Default `none` inline, `palette` when pannable. |
| `src` | URL | Load the source from a `.mmd` / text file instead of the element's text. |
| `name` | text | File name for exports. Default: the block's `@title`, else `my-wermaid`. |
| `streaming` | present | The source is still arriving: draw nothing, show no error. Removing it renders at once. See "Chat and streaming". |
| `persist` | `off` | Keep no adjustments in the browser (below). |
| `persist-key` | text | Tells identical diagrams apart for the stored adjustments (below). |

Notes:

- `defineWermaidElement(mermaid, { tag, fonts, config, defaults })` calls `mermaid.initialize` with
  `startOnLoad: false` (so Mermaid doesn't also render the blocks) and `securityLevel: 'strict'`;
  `config` adds to that. `tag` renames the element. `defaults` sets `theme`, `features`, `formats`
  and `persist` for every diagram. `fonts: false` stops it adding the IBM Plex Mono stylesheet the
  `wermaid` theme uses.
- Diagrams render in shadow DOM, so page CSS doesn't leak in. A diagram inside something hidden
  (a closed tab, `display: none`) waits until it's visible, since Mermaid needs real text sizes.
- Exports leave out the toolbar and editing handles; inside Claude artifacts, saving goes through
  the viewer's save prompt.

### Features

`features` is a space-separated list of exactly what is on. Without the attribute you get
`copy download`; `features="none"` turns every control off. In JS: `el.features = ['edit', 'themes']`.
Page-wide: `defineWermaidElement(mermaid, { defaults: { features: ['copy', 'download', 'edit'] } })`
(`defaults` also takes `theme`, `formats` and `persist`), and `run({ attributes })` sets
attributes on every block it upgrades.

| Feature | What the user gets | Default |
|---|---|---|
| `copy` | Copy button: copies the diagram as a PNG image | on |
| `download` | Download button: saves the diagram (PNG unless `formats` says otherwise) | on |
| `edit` | Drag shapes to nudge them, Alt-drag to pin, resize from corners, drag lines to bend them, move labels and subgraph frames, arrow keys to nudge (Shift: 10), Delete to reset the selection | off |
| `undo` | Undo and Redo buttons and Ctrl/⌘ Z (Shift+Ctrl/⌘ Z or Ctrl/⌘ Y redoes) | on with `edit` |
| `reset` | Reset button: back to the layout the diagram arrived with | on with `edit` |
| `themes` | Theme picker | off |
| `edges` | Edge-look picker (theme default, rounded, orthogonal, curved, Mermaid curves) | off |
| `zoom` | Pan and zoom, with zoom buttons and Fit; implies `pannable` | off |
| `compare` | "Mermaid's layout" toggle showing Mermaid's untouched drawing, curves included | off |

- `edit` adds `undo` and `reset` unless the list names either one, in which case the list is taken
  as written: `features="edit undo"` has Undo but no Reset.
- `formats="png svg md"` sets what Download offers. One format is a plain button; several turn it
  into a small menu. `md` is the source in a ```` ```mermaid ```` fence, layout block included.
- The toolbar sits in the diagram's top-right corner. With a mouse it appears on hover or keyboard
  focus; on touch screens it is always shown. Every control is a labelled button or select that
  can be reached with the keyboard. Restyle it with the `--wermaid-ui-bg`, `--wermaid-ui-fg`,
  `--wermaid-ui-muted` and `--wermaid-ui-line` variables or `::part(toolbar)` (other parts:
  `viewport`, `stage`, `note`, `error`).
- With `edit` on the element takes keyboard focus; arrow keys, Delete and undo act only while focus
  is inside it. Editing works as in the full editor, including its selection handles and snapping.
- A pick in the theme picker is written into the diagram's block as `%% @theme`, and an edge-look
  pick as `%% @edges`, so both travel with the source. "Theme default" removes `@edges`.
- Copy puts a PNG on the clipboard where the browser allows it, and says so where it doesn't.

### Events and properties

```js
const el = document.querySelector('wermaid-diagram');
await el.rendered;                 // promise for the latest render
el.diagram;                        // the library's diagram object (geometry, toSVG(), toPNG(), …)
el.editedSource;                   // the source with its current layout block (supplied source plus edits)
el.fit();                          // re-centre a pannable viewer
el.addEventListener('wermaid:render', (e) => e.detail.diagram);
el.addEventListener('wermaid:error', (e) => e.detail.error);   // also shown in place of the diagram
el.addEventListener('wermaid:change', (e) => e.detail);        // { source, reason }
```

`wermaid:change` fires once per completed adjustment, not while a drag is in progress.
`detail.source` is the full Mermaid source with its layout block rewritten; `reason` is `drag`,
`key`, `pin`, `style` (an edge's own style), `edges`, `theme`, `undo`, `redo` or `reset`. All three
events bubble and cross the shadow boundary, so one listener on the page catches every diagram.

### Keeping adjustments

While `edit` is on, adjustments are kept in the user's browser (`localStorage`) and put back when
the same diagram renders again: after a reload, or when a chat app re-renders an old answer. What's
kept is the diagram's layout block, which includes the user's theme and edge-look picks.

- "The same diagram" is a hash of the source as the app supplied it. Set
  `persist-key="message-123:diagram-1"` to tell identical diagrams apart: the key is stored with
  the hash, so a different source under the same key starts fresh. Changing the key later doesn't
  migrate adjustments stored under the old one.
- Reset clears the stored entry. `persist="off"` on the element, or
  `defaults: { persist: false }`, keeps nothing.
- Stored adjustments are per browser and device, never synced. The 200 most recently used diagrams
  are kept. Where storage is missing, full or blocked, the diagram carries on without keeping
  anything.
- Apps that store conversations can save `e.detail.source` from `wermaid:change` and pass it back
  next time (`el.source = saved`, or as the element's text). That text has a different hash, so
  the browser's copy never interferes.

### Chat and streaming

`run({ root, selector, attributes, watch, settle })` replaces each match of `pre.mermaid,
pre.wermaid, pre > code.language-mermaid, pre > code.language-wermaid` (the last two are what
Markdown renderers emit for fenced blocks) with a `<wermaid-diagram>`, copying `data-theme`,
`data-dark`, `data-pannable`, `data-controls`, `data-features`, `data-formats`, `data-height` and
`data-background` across. `attributes` sets defaults for every block, e.g.
`run({ attributes: { features: 'copy download edit' } })`. It returns a promise that settles when
every diagram has rendered.

For pages that write answers in as they stream, add `watch: true`:

```js
const chat = document.querySelector('#chat');     // the container whose children are the messages
const watcher = run({ root: chat, watch: true, attributes: { features: 'copy download edit' } });
// watcher.stop() ends the watching; await watcher settles once the first blocks have rendered
```

- Blocks already on the page render at once, so static pages don't wait. A new or changing block
  renders once its text has been still for `settle` ms (default 400), so a half-written diagram
  isn't drawn or reported as an error. A block the app keeps writing into after it was drawn waits
  the same way, then redraws.
- Pass the chat container whose children are the messages as `root`: not `document`, and not a
  single message. A block is followed by its place in its message (the child of `root` it sits in),
  which is what lets apps that rebuild the message with `innerHTML` on every chunk work: the
  `<pre>` is new each time, the place isn't.
- For those rebuild-style apps, once a diagram has been drawn each chunk makes one
  `wermaid:render` and no new Mermaid run: the drawing comes from a cache of the 50 most recent
  sources. The cache isn't cleared by a later `mermaid.initialize`. Stored adjustments are put back
  as usual.
- `watcher.stop()` ends the watching. `run()` replaces the blocks it upgrades, so it is for pages
  whose DOM the page owns. React and other frameworks that own their DOM use the element directly
  (below), never `run()`.
- Apps that render the element themselves can set the `streaming` attribute while the answer is
  arriving; the element draws nothing and shows no error until it's removed, then renders at once.
  An element without it renders immediately. The element also re-renders when its own text changes,
  so frameworks that update the text in place work.

#### One line

`src/auto.js` imports Mermaid, registers the element and starts `run({ watch: true })` on the
whole page:

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@v0.4.0/src/auto.js"
        data-features="copy download edit"></script>
```

| Attribute on the script tag | |
|---|---|
| `data-features` | Space-separated features for every diagram |
| `data-formats` | Space-separated download formats, e.g. `png svg` |
| `data-theme` | The theme every diagram starts with |
| `data-persist` | `off` keeps no adjustments |
| `data-mermaid` | URL of the Mermaid ES module to use. Default: Mermaid 11.16.1 from jsDelivr. Any URL form works (`https://…`, `/vendor/mermaid.esm.min.mjs`, `vendor/mermaid.esm.min.mjs`); it is resolved against your page. |
| `data-watch` | `false` upgrades only the blocks already on the page |

`auto.js` watches the whole document. For a rebuild-style chat app, call `run` yourself with the
chat container as `root` so each message is followed by its place.

### React

`<wermaid-diagram>` is a custom element, so React uses it directly. Load the element once at
runtime (a dynamic import in the app's root, or `auto.js` in the page head for pages React doesn't
own; not `auto.js` if React renders Mermaid blocks, because its `run()` would replace them):

```jsx
const mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs')).default;
const { defineWermaidElement } = await import('https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@v0.4.0/src/element.js');
defineWermaidElement(mermaid, { defaults: { features: ['copy', 'download', 'edit', 'themes'] } });
```

Bundlers leave a dynamic import of a full URL alone with a magic comment
(`/* @vite-ignore */`, `/* webpackIgnore: true */`).

Passing the source:

```jsx
// React 18: props become attributes, so pass the source as text
<wermaid-diagram features="edit themes">{code}</wermaid-diagram>

// React 19: props that match a property of the element are set as properties
<wermaid-diagram source={code} features={['edit', 'themes']} />
```

The text form works in both and whether or not the element was defined before React rendered; the
property form needs the element defined first. For `streaming` pass a string, which works in both:
`streaming={streaming ? '' : undefined}`.

**react-markdown.** Override the `code` component: return `<wermaid-diagram>` for
`language-mermaid` and leave other blocks alone. The context carries "the answer is still arriving"
down without remounting the diagram:

```jsx
import Markdown from 'react-markdown';

const Streaming = React.createContext(false);

function Code({ className, children, ...rest }) {
  const streaming = React.useContext(Streaming);
  if (/language-mermaid/.test(className ?? '')) {
    return (
      <wermaid-diagram features="copy download edit themes" streaming={streaming ? '' : undefined}>
        {String(children).replace(/\n$/, '')}
      </wermaid-diagram>
    );
  }
  return <code className={className} {...rest}>{children}</code>;
}

function Answer({ text, streaming }) {
  return (
    <Streaming.Provider value={streaming}>
      <Markdown components={{ code: Code }}>{text}</Markdown>
    </Streaming.Provider>
  );
}
```

react-markdown draws fenced blocks inside a `<pre>`, so the diagram sits in it; restyle that
`<pre>` or override `pre` too if you don't want its box.

**Streamdown** and other streaming Markdown components have the same slot, the code-block
component override. Use the same component there; if the library tells you a block is still being
written, pass that as `streaming`.

**`createMermaidBlock`** is that component, ready-made. `src/react.js` takes your React instead of
importing it, so it loads from a CDN:

```jsx
import { createMermaidBlock } from 'https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@v0.4.0/src/react.js';

const MermaidBlock = createMermaidBlock(React, { features: ['copy', 'download', 'edit'], formats: ['png', 'svg'], theme: 'acme' });
<Markdown components={{ code: MermaidBlock }}>{answer}</Markdown>
```

It returns `<wermaid-diagram>` for `language-mermaid` blocks and a plain `<code>` for the rest, and
takes a `streaming` prop.

## Library

```js
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs';   // v11+
import { createWermaid } from 'https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@v0.4.0/src/wermaid.js';

const wermaid = createWermaid(mermaid);
const diagram = await wermaid.render(container, source, { theme: 'pele', dark: false });
diagram.geometry;                 // final node/subgraph boxes and edge points
diagram.warnings;                 // unknown themes and other soft problems
diagram.setOverrides(next);       // re-apply without re-running Mermaid
diagram.showStock();              // Mermaid's own layout (its curves too)
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

## Upgrading from 0.3

- Diagrams without a `features` attribute now show Copy and Download buttons. Add
  `features="none"` for the old, plain look. `controls` still gives the classic toolbar.
- A diagram's own `%% @theme` now beats the element's `theme` attribute (it used to be the other
  way round). The attribute is the starting theme for diagrams that name none.
- An unknown `%% @theme` name is a warning (`diagram.warnings`), not an error; the diagram draws
  in the next theme down.
- "Palettes" are now themes. `src/themes.js` still holds the built-in three; add your own with
  `defineTheme` instead of editing that file.

## Logo

`assets/wermaid-mark.svg` is the mark: one routed connector, from a start node to an arrowhead,
drawn as a W. `assets/wermaid-icon.svg` is the favicon cut (no node, heavier line), and
`assets/wermaid-logo.svg` pairs the mark with the serif wordmark. All three switch to light
strokes in dark mode.

The name: Wermaid is Mermaid with its M flipped over into a W.

## Thanks

- **[Steph Ango](https://stephango.com) ([@kepano](https://github.com/kepano))** for
  [Pele](https://pele.run) ([source](https://github.com/obsidianmd/pele), MIT) and
  [Flexoki](https://stephango.com/flexoki), the look and colours of the `pele` theme.
  Wermaid borrows the look, not the code.
- **[Mermaid](https://mermaid.js.org)**, which parses, lays out and draws every diagram.
- **[IBM Plex Mono](https://github.com/IBM/plex)**, the editor's typeface.

## Development

```
npm install
npm run link-mermaid      # serves node_modules/mermaid/dist at /mermaid-dist for tests
npm run build             # inlines the src modules and examples into dist/editor.html and dist/embed-demo.html
npm run serve &           # http://127.0.0.1:8765/dist/local.html?mermaid=/mermaid-dist/mermaid.esm.min.mjs
npx playwright install chromium
npm test
```

- `src/wermaid.js` – the library (no dependencies besides the Mermaid instance you pass in)
- `src/themes.js` – themes: the built-in three, `defineTheme`
- `src/element.js` – `<wermaid-diagram>` and `run()`
- `src/edit.js` – dragging, resizing and bending, shared by the editor and the element
- `src/persist.js` – keeping adjustments in the browser
- `src/auto.js` – one-line setup; `src/react.js` – `createMermaidBlock`
- `src/editor.html` – editor template; `src/examples.mjs` – the bundled examples
- `src/embed-demo.html` – embedding demo template (built to `dist/embed-demo.html`)
- `test/m1.html` – library suite: stock-identical render, local effect, subgraph refit, stale ids,
  round trip, obstacle avoidance
- `test/interact.mjs` – editor suite: nudge/pin, resize, bends, labels, undo, examples
- `test/export.mjs` – PNG/SVG export; `test/embed.mjs` – element and `run()` suite
- `test/features.mjs` – element features, themes, events, persistence; `test/watch.mjs` – `run({ watch })`, streaming, `auto.js`

## Known limits

- Edges with manual bends (`via`) go straight through the bends you set and don't avoid shapes.
- Subgraph frames aren't obstacles: routes may cross a subgraph they don't belong to.
- Class diagram cardinality labels ("1", "*") stay where Mermaid put them when an edge moves.
- Overrides are applied after Mermaid's layout, so the rest of the diagram doesn't make room for
  a moved shape.
