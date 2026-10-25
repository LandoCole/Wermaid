# Custom themes and the embeddable editor

Design, 2026-10-25. Status: draft for approval.

## Why

Most places that show Mermaid diagrams, AI chat answers above all, render a static picture with a
copy button. When Mermaid puts a shape in the wrong place, the reader is stuck with it. Wermaid
already fixes that in its own editor. This work brings the fix to wherever a diagram is shown:
a developer drops a Wermaid diagram into their app, chooses which tools it offers, and their users
straighten the layout, switch the look, and save the result as an image or SVG for their docs.

Chat is the first use case, not the only one. Docs sites, wikis, notebooks and internal tools all
show Mermaid and all hit the same problem.

Developers also need diagrams to look like their product, so they need to define their own themes,
and they need somewhere to design those themes without guessing at numbers.

## Goals

1. **Custom themes, defined in code by developers.** A theme covers colours, text, edges and
   shapes, in light and dark. A registered theme works exactly like the built-in ones (`wermaid`,
   `mermaid`, `pele`): by name in `%% @theme`, in the `theme` attribute, and in theme pickers.
2. **A configurable `<wermaid-diagram>`.** One element runs from a plain viewer to an inline
   editor. Developers switch features on one by one. The default stays deliberately plain: the
   diagram in the default theme, with a Copy button and a Download button.
3. **Adjustments that stick, with no plumbing.** When users adjust a diagram, the adjustments
   survive a reload by default. Apps that want more can save the edited source themselves.
4. **Drop-in for chat and Markdown.** Works with the HTML that Markdown engines already produce,
   including answers that stream in, and with React chat UIs.
5. **A theme builder on wermaid.com.** Build and preview a theme on a real diagram, then copy the
   code into an app.

## Non-goals

- Publishing to npm. Wermaid stays CDN-only for now, loaded from jsDelivr (decided).
- End users creating themes inside embedded diagrams. Developers define themes; users pick among
  the ones offered.
- Themes travelling inside a diagram's source. A diagram saved with `%% @theme acme` shows the
  default look anywhere `acme` isn't registered.
- Plugins for markdown-it, marked or rehype. Planned later, not in this work (decided).
- A source-text panel inside embedded diagrams. The embedded editor adjusts layout; editing the
  Mermaid text stays with the full editor.
- Syncing adjustments across devices. Apps can build that on the change event.

## Anti-goals

These would make the work a failure even if every feature technically works.

- **A cluttered default.** If a developer adds `<wermaid-diagram>` and gets a toolbar full of
  controls, it has failed. Nothing beyond Copy and Download appears unless asked for.
- **Breaking existing embeds.** Today's attributes (`pannable`, `controls`, `theme`, `dark`,
  `height`, `background`, `src`, `name`) keep their meanings. The one deliberate visible change:
  diagrams without a `features` attribute gain the default Copy and Download buttons, because
  that is the agreed default. `features="none"` opts out, and wermaid.com's layered hero diagrams
  will use it.
- **Diagrams that only work in Wermaid.** Edited diagrams must still be plain Mermaid with a
  comment block, drawing the stock layout in GitHub, Notion and everything else.
- **Distorted shapes.** Nothing in themes or editing may stretch shapes out of their natural
  proportions as a side effect.
- **Plumbing for basics.** Persistence, streaming and theming must work without the developer
  writing glue code.

## Constraints

- Mermaid v11, passed in by the host page as today. No other runtime dependencies.
- Shipped modules contain **no bare imports** (`import x from 'react'`), so each one loads straight
  from jsDelivr in a browser with no build step.
- Diagrams render in shadow DOM with Mermaid's `strict` security level, as today.
- Controls are reachable by keyboard, labelled, and show visible focus.
- Existing test suites keep passing; each new feature gets tests in `test/`.
- Changes are shown to the project owner locally before anything is pushed or deployed.

## Part 1: custom themes

### Defining a theme

```js
import { defineTheme } from 'https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@v0.4.0/src/wermaid.js';

defineTheme('acme', {
  label: 'Acme',
  extends: 'wermaid',                 // optional: a built-in or another custom theme
  font: { family: '"Inter", system-ui, sans-serif', size: 14, weight: 400,
          stylesheet: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap' },
  colors: {
    background: '#ffffff', text: '#1b1b1f', muted: '#6b6b73', line: '#1b1b1f',
    nodeFill: '#f4f4f6', nodeBorder: '#c9c9d1',
    groupFill: '#fafafa', groupBorder: '#dedee4', labelBackground: '#ffffff',
  },
  shapes: { radius: 6, borderWidth: 1 },
  edges:  { style: 'rounded', radius: 6, width: 1 },
  dark:   { colors: { background: '#111114', text: '#ececf1', /* … */ } },
});
```

- The spec is plain data, so the same object can live in a JSON config file:
  `defineTheme('acme', await (await fetch('/acme-theme.json')).json())`.
- Every field is optional. Missing fields come from `extends`, else from `wermaid`.
- `font.stylesheet` is loaded once, when a diagram first uses the theme. A theme without one just
  names a font the page already has.
- **Dark variants** *(my call)*: `dark` holds overrides for dark mode. Any colour it leaves out is
  derived from the light colour (same hue, lightness flipped, contrast kept). The builder chooses
  the exact derivation.
- `defineTheme` returns nothing and may be called again to replace a theme. `listThemes()`
  returns `[{ name, label }]` for pickers.
- `defineTheme` is exported from `wermaid.js` and re-exported from `element.js`, so a page that
  loads only the element can define themes.
- `spacing: { node, rank, padding }` sets Mermaid's layout spacing. Changing spacing moves Mermaid's
  auto layout, so `nudge` offsets shift with it; the docs and the theme builder say so.
- **What `extends` accepts** *(my call)*: `wermaid`, `pele`, or another custom theme. Every custom
  theme is drawn with Mermaid's `base` theme driven by the spec, so it inherits the colours, font,
  spacing and shape and edge settings of what it extends. `extends: 'mermaid'` isn't supported,
  because that theme is Mermaid's own `neutral`/`dark` rather than a set of values; it falls back
  to `wermaid` with a warning.
- Only the `pele` theme itself reads the page's `--pele-*` CSS variables. A theme that extends
  `pele` starts from Pele's published colours.
- **Built-ins** keep their current looks exactly. Whether they are re-expressed as specs
  internally is the builder's choice.

### Which theme a diagram uses

From strongest to weakest *(my call; this reverses today's rule, where the attribute beats the
block)*:

1. The block's `%% @theme`. A user's pick in the theme picker is written here, so it travels with
   the saved source, the Markdown export and the stored adjustments.
2. The element's `theme` attribute: the developer's starting theme for diagrams that don't name one.
3. The page default: `defineWermaidElement(mermaid, { defaults: { theme: 'acme' } })`
4. `wermaid`

The reversal is what makes the save-and-restore pattern work. An app that keeps `theme="acme"` on
the element and passes back a saved source containing the user's `%% @theme` shows the user's pick.
It changes behaviour only for diagrams that name a theme in their block *and* sit in an element
with a different `theme` attribute.

The same applies to edge looks: a pick in the edge-look picker is written as `%% @edges`.

An unknown name falls through to the next level and adds a warning (shown in the editor, available
on `diagram.warnings`), never an error.

### Edges: theme versus diagram

A theme's `edges.style` is the starting look. The block's `%% @edges` overrides it, and a per-edge
`style` overrides both. Today's behaviour when nothing is set (untouched edges keep Mermaid's curves)
is what a theme gets with `edges.style: 'mermaid'`. The built-in themes use that.

## Part 2: the configurable `<wermaid-diagram>`

### Features

| Feature | What the user gets | Default |
|---|---|---|
| `copy` | Copy button: copies the diagram as a PNG image | on |
| `download` | Download button: saves the diagram (PNG unless `formats` says otherwise) | on |
| `edit` | Drag shapes to nudge them, Alt-drag to pin, resize from corners, drag lines to bend them, move labels and subgraph frames, arrow keys to nudge, Delete to reset the selection | off |
| `undo` | Undo and Redo buttons and Ctrl/⌘ Z | on with `edit` |
| `reset` | Reset button: back to the layout the diagram arrived with | on with `edit` |
| `themes` | Theme picker | off |
| `edges` | Edge-look picker | off |
| `zoom` | Pan and zoom, with zoom buttons and Fit; implies `pannable` | off |
| `compare` | "Mermaid's layout" toggle showing the stock drawing | off |

- **Setting them** *(my call)*: a space-separated attribute lists exactly what's on:
  `<wermaid-diagram features="copy download edit themes">`. Without the attribute, the default
  set (`copy download`) applies; `features="none"` turns every control off. In JS: `el.features = ['edit', 'themes']`. Page-wide:
  `defineWermaidElement(mermaid, { defaults: { features: [...] } })`, and `run({ attributes })`
  as today.
- `formats="png svg md"` sets what Download offers. One format is a plain button; several turn it
  into a small menu. `md` is the source in a ```` ```mermaid ```` fence, layout block included.
- `themes="wermaid acme"` limits the picker to those themes; without it, the picker lists every
  registered theme.
- **Backward compatibility:** `controls` keeps today's toolbar: it is shorthand for
  `features="zoom copy download" formats="png svg"`. If an element has both `controls` and
  `features`, `features` wins. `pannable` keeps its fixed-height canvas.

### What the user sees

- **Toolbar placement** *(my call)*: a compact toolbar in the top-right corner of the diagram,
  styled like today's `controls` toolbar. On devices with a mouse it appears on hover or keyboard
  focus. On touch devices it is always shown. The builder decides the exact visual design within
  the existing style.
- With `edit` on, editing works exactly as in the full editor, including its overlay, selection
  handles and snapping.
- Colours of the toolbar follow light/dark as today and can be restyled with the existing
  `--wermaid-ui-*` variables and `::part(toolbar)`.

### Events and properties for apps

- `wermaid:change`, fired once per completed adjustment (on drag end, on undo, on reset, on
  theme or edge-look pick): `detail: { source, reason }`. `source` is the full Mermaid source with
  its layout block rewritten.
- `el.editedSource` returns that same text at any time.
- Setting `el.source` (or the text, or `src`) loads a new diagram as today. An app that saved
  `detail.source` passes it back this way next time.

### Sharing the editing code

*(My call.)* The editing behaviour lives inside `src/editor.html` today, tied to that page. It
moves into a shared module (`src/edit.js`) that both the full editor and `<wermaid-diagram>` use,
so the two can't drift apart. The full editor must behave exactly as before, with its test suite
(`test/interact.mjs`) passing.

## Part 3: keeping adjustments

- **On by default whenever `edit` is on.** Adjustments are stored in the user's browser and put
  back when the same diagram renders again: after a reload, or when a chat app re-renders an old
  answer.
- **Which diagram is "the same"** *(my call)*: by default, a hash of the source as the app
  supplied it. A developer can set `persist-key="message-123:diagram-1"` to tell identical
  diagrams apart.
- What's stored: the layout block, which includes the user's theme and edge-look picks.
- Reset clears the stored entry.
- `persist="off"` on the element, or `defaults: { persist: false }`, turns it off.
- **Limits:** per browser and device only. Storage is capped *(my call: the 200 most recently used
  diagrams)*, dropping the least recently used.
- **Apps that store conversations** save `detail.source` from `wermaid:change` and pass it back
  next time. That source has a different hash, so the browser's stored copy doesn't interfere.
  Docs show this pattern.

## Part 4: chat and Markdown

### Pages that output HTML

- `run({ watch: true })` keeps watching the page and upgrades each Mermaid block as it appears.
  It uses the same selectors and data attributes as `run()` today.
- **Streaming** *(my call)*: the watcher, not the element, waits for a block to settle. A block
  is rendered once its text has been unchanged for a short time (about 400 ms). Blocks already
  on the page when `run()` starts render immediately, so static pages don't wait.
- **Apps that rebuild the message on every chunk** (setting `innerHTML` again, which recreates the
  `<pre>` each time) are supported. The watcher keys the settle timer by the block's position in
  its message, and keeps a cache of rendered diagrams keyed by source. A block that reappears with
  the same source reuses the cached drawing instead of running Mermaid again, and stored
  adjustments are put back as usual.
- `run()` replaces the blocks it upgrades, so it is for pages whose DOM the page itself owns.
  React and other frameworks that own their DOM use the element directly (below), never `run()`.
- **The `streaming` attribute**, for apps that render the element themselves: while present, the
  element draws nothing and shows no errors; when it's removed, the element renders at once. An
  element without it renders immediately, with no delay.
- The element re-renders when its own text content changes, so frameworks that update the text in
  place work too.
- **One-line setup** *(my call)*: `src/auto.js`, loaded with a single script tag, imports Mermaid
  from jsDelivr, registers the element and starts `run({ watch: true })`. Options are read from
  `data-*` attributes on the script tag, for example
  `<script type="module" src="…/src/auto.js" data-features="copy download edit"></script>`.

### React chat UIs

CDN-only rules out a normal React package, because a module that imports `react` can't load from a
CDN without a build step. *(My call; this changes the earlier plan for a ready-made component, so
check it.)*

- `<wermaid-diagram>` is used directly from React. React 19 passes properties to custom elements
  natively, and for React 18 the element reads its text children:
  `<wermaid-diagram features="edit themes">{code}</wermaid-diagram>`.
- The docs give a short recipe for the code-block slot of react-markdown and Streamdown: return
  `<wermaid-diagram>` for `language-mermaid` and leave other blocks alone, with a `streaming` flag
  passed through while the answer is still arriving.
- `src/react.js` adds a small helper that takes the app's React instead of importing it:
  `const MermaidBlock = createMermaidBlock(React, { features: [...] })`. It's for apps that want
  a ready-made code-block component, with no bare imports.
- The element is loaded once at runtime: `auto.js` in the page head, or a dynamic import in the
  app's root component.

### Versions on jsDelivr

*(My call.)* Releases are git tags (`v0.4.0`), and the docs pin to a tag. `@main` stays available
for people who want the latest, but it isn't what the docs recommend.

## Part 5: the theme builder on wermaid.com

- A **Theme** panel in the editor, next to the diagram being edited. Changes show on the diagram
  immediately.
- Start from any registered theme. Controls exist for every field in the theme spec: colours,
  font, edge style and thickness, corner rounding and border width.
- Light and dark are edited side by side, with a switch that previews either. Dark starts out
  derived from light, and any derived value can be overridden.
- **Copy code** gives the `defineTheme('name', { … })` snippet. **Copy JSON** gives the same spec
  as JSON.
- **Paste** imports an existing theme to keep editing it.
- Themes being edited are kept in the browser between visits.
- A theme built here appears in the editor's Palette menu, so exports from wermaid.com can use it.
- This lives in the public repo's editor (`src/editor.html`), so it ships to wermaid.com through
  the site's normal update path.

## Suggested order

Each step is usable on its own and can be shipped separately.

1. Custom themes (`defineTheme`, `listThemes`, theme precedence, theme edge styles).
2. Move the editing code into `src/edit.js`, with the full editor unchanged and its tests passing.
3. Element features, toolbar, `formats`, events and persistence.
4. `run({ watch })`, streaming, `auto.js`, React recipe and `react.js`.
5. Theme builder in the editor.
6. Docs: the README (CDN-only, so the "With npm" instructions come out) and the wermaid.com docs
   page, including chat and React recipes. Tag the release.
7. wermaid.com: bump the `wermaid-site` submodule, serve `edit.js`, `auto.js` and `react.js` from
   `/lib`, keep the site's editor header patch working with the Theme panel, and set
   `features="none"` on the hero's layered diagrams. Shown locally and approved before deploy.

## Left to the builder

- Visual design of the toolbar, menus and theme panel, within the existing drafting-sheet style.
- The dark-colour derivation, the storage format and the eviction details.
- Module structure beyond `src/edit.js`, `src/auto.js` and `src/react.js`.
- Test organisation within `test/`.
