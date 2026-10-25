# Custom Themes and Embeddable Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Developer-defined themes, a `<wermaid-diagram>` whose features switch on one by one up to a full inline editor (with persistence, streaming support and React use), and a theme builder in the editor.

**Architecture:** Themes become a registry in `src/themes.js` that compiles plain-data specs into the same internal shape the built-in palettes use. The editor's drag/overlay/keyboard code moves into `src/edit.js` so the full editor and the element share it. The element gains a feature set driving its toolbar, built on that module; streaming and page watching live in `run()`; `auto.js` and `react.js` are thin, import-free entry points for CDN use.

**Tech Stack:** Vanilla ES modules, Mermaid 11.16.1 (passed in by the host page), Playwright test scripts (`test/*.mjs`), jsDelivr for distribution.

**Spec:** `docs/superpowers/specs/2026-10-25-themes-and-embedded-editor-design.md`

## Global Constraints

- Mermaid v11, passed in by the host page. No other runtime dependencies.
- Shipped modules (`src/*.js`) contain no bare imports; relative imports only (`./wermaid.js`).
- Diagrams render in shadow DOM with `securityLevel: 'strict'`.
- Controls are keyboard reachable, have accessible names, and show visible focus.
- Every attribute that exists today (`pannable`, `controls`, `theme`, `dark`, `height`, `background`, `src`, `name`) keeps its meaning. `theme="none"` keeps leaving Mermaid's config alone.
- Nothing stretches shapes as a side effect of themes or editing.
- All suites pass after every task: `npm test` (library, editor, export, embed, plus the suites this plan adds).
- Commits stay local. Nothing is pushed, tagged or deployed until the project owner has seen the result and approved that specific push (Task 11).
- Commit identity in this repo: `LandoCole <lthornton724@gmail.com>`; every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Version becomes `0.4.0` (`VERSION` in `src/wermaid.js`, `package.json`).

## Review Focus

1. **The same diagram arriving with different whitespace** (indented inside the element, CRLF line endings, a trailing newline): users expect their stored adjustments back. Pinned in Task 6 (`persist key ignores indentation and line endings`).
2. **Browser storage unavailable** (private mode, storage throwing, quota full): editing must still work, with no errors and no stored state. Pinned in Task 6 (`edit works when localStorage throws`).
3. **Clipboard unavailable or refused** (insecure context, no `ClipboardItem`, permission denied): Copy says so in the diagram's note instead of throwing. Pinned in Task 5 (`copy without ClipboardItem shows a note`).
4. **Several editable diagrams on one page**: arrow keys and Delete act only on the diagram that has focus. Pinned in Task 5b (`keys only move the focused diagram`).
5. **A streamed diagram whose finished source is invalid**: once it settles, the error shows, once, with no flicker of earlier partial errors. Pinned in Task 7 (`invalid final source shows one error after settling`).

---

### Task 1: Green test baseline and a configurable test port

**Files:**
- Modify: `test/run.mjs`, `test/interact.mjs`, `test/export.mjs`, `test/embed.mjs`, `test/shot.mjs` (base URL)
- Modify: `package.json` (`serve` script reads the same port)
- Modify: whichever of `src/editor.html` / `test/interact.mjs` is wrong for the two failing tests

**Interfaces:**
- Produces: every suite reads `const BASE = \`http://127.0.0.1:${process.env.WERMAID_TEST_PORT || 8765}\``. Later tasks' new suites use the same line.

- [ ] **Step 1:** Replace the hard-coded `http://127.0.0.1:8765` in the five scripts with `BASE`; make `npm run serve` use `${WERMAID_TEST_PORT:-8765}`.
- [ ] **Step 2:** Run `WERMAID_TEST_PORT=8799 npm run serve &` then `WERMAID_TEST_PORT=8799 npm test`. Expected now: library 49/49, export and embed all PASS, editor 32 PASS with 2 FAIL: `body edit re-renders with new node` and `palette picker writes @theme and re-renders`.
- [ ] **Step 3:** Find the root cause of each failure with superpowers:systematic-debugging. Fix the code if the editor misbehaves, or the test if its expectation is outdated (the palette test reads a fill of `rgb(16, 15, 15)`, which is Pele's dark ink: check whether the page runs in dark mode or the test reads the wrong element). Say which in the commit message.
- [ ] **Step 4:** Run `npm test` on the custom port. Expected: every line PASS, no `PAGEERR`.
- [ ] **Step 5:** Commit: `Tests: configurable port; fix the two failing editor tests`.

---

### Task 2: Theme registry and theme specs

**Files:**
- Modify: `src/themes.js` (registry, spec compiler, dark derivation)
- Modify: `src/wermaid.js` (`@theme` parsing, `render()` theme resolution, theme edge default, `VERSION`)
- Modify: `build.mjs` only if the strip regexes miss new export forms
- Test: `test/m1.html` (new section 14)

**Interfaces:**
- Produces (exported from `src/themes.js`, re-exported from `src/wermaid.js`):
  - `defineTheme(name: string, spec: ThemeSpec): void`. `name` must match `/^[a-z][a-z0-9-]*$/`; built-in names (`mermaid`, `wermaid`, `pele`) throw `TypeError`; a custom name may be redefined.
  - `listThemes(): Array<{ name: string, label: string }>`, built-ins first, then custom in definition order.
  - `getTheme(name: string): Theme | null`
  - `ThemeSpec = { label?, extends?, font?: { family?, size?, weight?, stylesheet? }, colors?: { background?, text?, muted?, line?, nodeFill?, nodeBorder?, groupFill?, groupBorder?, labelBackground? }, shapes?: { radius?, borderWidth? }, edges?: { style?: 'rounded'|'orthogonal'|'curved'|'mermaid', radius?, width? }, spacing?: { node?, rank?, padding? }, dark?: Omit<ThemeSpec, 'label'|'extends'|'dark'> }`
  - Internal `Theme` keeps today's shape: `{ label, fonts?, credit?, background(dark, el), config({ dark, el }) }`, plus `edges: { style, radius } | null` (null = Mermaid's own curves) and `stylesheet: string | null`.
  - `render(container, source, { id, theme, defaultTheme, dark })`: `theme` still forces a palette (back-compat for library callers); `defaultTheme` applies only when the block names no registered theme. `diagram.theme` is the name used.
  - Parsing: `@theme <name>` accepts any name matching the pattern above. An unregistered name adds `Theme "<name>" isn't defined on this page; using <fallback>.` to `diagram.warnings` and is not a parse error.
  - Edge default: when the block has no `@edges`, routing uses the theme's `edges` (`scene.edgeDefault`). `@edges` beats it; per-edge `style` beats both.

- [ ] **Step 1: Write the failing tests** in `test/m1.html` section 14:

```js
defineTheme('acme', { label: 'Acme', colors: { nodeFill: '#ffeedd', background: '#ffffff', text: '#111111' },
  edges: { style: 'orthogonal' }, spacing: { node: 120 } });
ok('theme: listed', listThemes().some((t) => t.name === 'acme' && t.label === 'Acme'));
const a = await wermaid.render(el, BASE + '\n%% @layout\n%% @theme acme\n%% @end', { id: 't1' });
ok('theme: block @theme uses the spec fill', fillOf(a) === 'rgb(255, 238, 221)');
ok('theme: theme edge style routes every edge', [...a.geometry.edges.values()].every((g) => g.mode === 'route' && g.look === 'orthogonal'));
const b = await wermaid.render(el, BASE + '\n%% @layout\n%% @theme acme\n%% @edges curved\n%% @end', { id: 't2' });
ok('theme: @edges beats the theme', [...b.geometry.edges.values()].every((g) => g.look !== 'orthogonal'));
const d = await wermaid.render(el, BASE + '\n%% @layout\n%% @theme acme\n%% @end', { id: 't3', dark: true });
ok('theme: dark derived', luminance(d.background) < 0.2 && contrast(textOf(d), d.background) >= 4.5);
const u = await wermaid.render(el, BASE + '\n%% @layout\n%% @theme nope\n%% @end', { id: 't4' });
ok('theme: unknown name warns and falls back', u.parseErrors.length === 0 && u.warnings.some((w) => w.includes('"nope"')) && u.theme === 'wermaid');
const x = await wermaid.render(el, BASE, { id: 't5', defaultTheme: 'acme' });
ok('theme: defaultTheme when block names none', x.theme === 'acme');
const y = await wermaid.render(el, BASE + '\n%% @layout\n%% @theme pele\n%% @end', { id: 't6', defaultTheme: 'acme' });
ok('theme: block beats defaultTheme', y.theme === 'pele');
defineTheme('peach', { extends: 'pele' });
ok('theme: extends pele inherits its fill', fillOf(await wermaid.render(el, BASE, { id: 't7', theme: 'peach' })) === 'rgb(242, 240, 229)');
defineTheme('mm', { extends: 'mermaid' });
const m = await wermaid.render(el, BASE, { id: 't8', theme: 'mm' });
const w = await wermaid.render(el, BASE, { id: 't9', theme: 'wermaid' });
ok('theme: extends mermaid warns and uses wermaid', m.warnings.some((x) => x.includes('mermaid')) && fillOf(m) === fillOf(w));
ok('theme: built-in names are protected', throws(() => defineTheme('pele', {})));
ok('theme: spacing widens the layout', nodeGap(acmeRender) > nodeGap(wermaidRender));
```

`luminance`, `contrast`, `fillOf`, `textOf`, `nodeGap` are small helpers in the test file. The existing palette tests (section 13) must pass unchanged.

- [ ] **Step 2:** Build and run: `npm run build && node test/run.mjs test/m1.html`. Expected: the section 14 lines FAIL (`defineTheme is not defined`).
- [ ] **Step 3: Implement** `defineTheme`, `listThemes`, `getTheme` and the spec compiler in `src/themes.js`. Every custom theme compiles to Mermaid's `base` theme through `baseVariables()` plus a `themeCSS` built from `shapes` and `edges.width`. Missing fields come from `extends`, else `wermaid`. `extends: 'mermaid'` compiles as `wermaid` and the compiled theme carries a warning that `render()` adds to `diagram.warnings`. Dark: values in `dark` win, and each missing dark colour is derived from its light colour (same hue, lightness flipped); you choose the exact formula, provided the dark-contrast test holds. Only `pele` reads `--pele-*` variables.
- [ ] **Step 4: Implement** the parsing, `render()` and edge-default changes in `src/wermaid.js` as given in Interfaces. `VERSION = '0.4.0'`, with the same version in `package.json`.
- [ ] **Step 5:** Run `npm test`. Expected: all PASS, including sections 13 and 14.
- [ ] **Step 6:** Commit: `Themes: defineTheme, listThemes, theme specs with dark, edges and spacing`.

---

### Task 3: Theme precedence and page defaults in the element

**Files:**
- Modify: `src/element.js`
- Test: `test/embed.html`, `test/embed.mjs`

**Interfaces:**
- Consumes: `render(..., { defaultTheme })`, `defineTheme`, `listThemes`, `getTheme` (Task 2).
- Produces:
  - `defineWermaidElement(mermaid, { tag, fonts, config, defaults })` where `defaults = { theme?: string, features?: string[], formats?: string[], persist?: boolean }`, stored as a module-level `pageDefaults` that later tasks read.
  - `element.js` re-exports `defineTheme` and `listThemes`.
  - Theme order: block `@theme` → `theme` attribute → `pageDefaults.theme` → `wermaid`. `theme="none"` still renders with no palette.
  - A theme's `stylesheet` loads once (a `<link>` in `document.head`) before its first render. `ensureFonts` keeps handling built-ins.

- [ ] **Step 1: Write the failing tests:** add `<wermaid-diagram id="attr-vs-block" theme="pele">` containing a block with `%% @theme mermaid`, and `<wermaid-diagram id="page-default">` with no theme. The test page defines `acme` and passes `defaults: { theme: 'acme' }`.

```js
ok('block @theme beats the theme attribute', await p.$eval('#attr-vs-block', (e) => e.diagram.theme) === 'mermaid');
ok('theme attribute applies when the block names none', await p.$eval('#pele', (e) => e.diagram.theme) === 'pele');
ok('page default theme applies last', await p.$eval('#page-default', (e) => e.diagram.theme) === 'acme');
ok('theme stylesheet loaded once', await p.$$eval('link[data-wermaid-theme="acme"]', (l) => l.length) === 1);
```

- [ ] **Step 2:** Run `node test/embed.mjs`. Expected: the four new lines FAIL.
- [ ] **Step 3:** Implement as given in Interfaces. In `_render`, pass the attribute or page default as `defaultTheme`, never as `theme`, except `none`.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `Element: a diagram's @theme beats the attribute; page defaults; theme stylesheets`.

---

### Task 4: Move the editing code into `src/edit.js`

**Files:**
- Create: `src/edit.js`
- Modify: `src/editor.html` (use the module; keep its source panel, strip, examples, pan/zoom, export, undo UI)
- Modify: `build.mjs` (inline `edit.js` into the editor after `wermaid.js`)
- Test: `test/interact.mjs` (unchanged; it is the proof)

**Interfaces:**
- Produces:

```js
export function createEditor(surface: Element, {
  snap = () => false,          // () => boolean: 8-unit grid while dragging
  scale = () => 1,             // () => screen px per diagram unit (handle and hit sizes)
  onPreview = () => {},        // (overrides) while a drag is in progress
  onCommit = () => {},         // (overrides, reason: 'drag'|'key'|'reset'|'pin'|'style')
  onSelect = () => {},         // (selection | null)
}): {
  attach(diagram, overrides),  // after every render; drops a selection whose target is gone
  readonly selection,          // { kind: 'node'|'cluster'|'edge', id } | null
  select(selection | null),
  readonly overrides,
  apply(),                     // re-apply overrides (or stock) and redraw the overlay
  setStock(on: boolean),
  nudge(dx, dy), resetSelection(), pin(), unpin(),
  setEdgeStyle(edgeId: string, style: 'rounded'|'orthogonal'|'curved'|null),
  handleKey(ev: KeyboardEvent): boolean,   // arrows (Shift = ×10), Delete/Backspace, Escape; true if handled
  destroy(),
}

export function createHistory(limit = 200): {
  push(text), undo(current) /* → text | null */, redo(current) /* → text | null */,
  clear(), readonly canUndo, readonly canRedo,
}
```

  - The overlay keeps its classes (`.wm-overlay`, `.wm-hit`, `[data-handle="corner:se"]` and so on), so export stripping and the editor tests keep working.
  - Pointer handling is attached to `surface`. Background presses that aren't on a shape are left for the host's panning (the module never calls `preventDefault` on them).

- [ ] **Step 1:** Run `npm run build && node test/interact.mjs` and record the PASS count from Task 1 (all PASS).
- [ ] **Step 2:** Move overlay drawing, hit paths, node/cluster/edge/label dragging, resizing, bends, `placeNode`, pin/unpin, edge style and the keyboard actions from `src/editor.html` into `src/edit.js` behind `createEditor`. Move the undo stacks behind `createHistory`. The editor wires `onCommit` to its existing `writeBack({ commit: true })` and `onPreview` to `writeBack()`.
- [ ] **Step 3:** Run `npm run build && node test/interact.mjs`. Expected: the same lines all PASS.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `Editor: move editing into src/edit.js (createEditor, createHistory)`.

---

### Task 5: Element features, toolbar, Copy and Download

**Files:**
- Modify: `src/element.js`
- Create: `test/features.html`, `test/features.mjs`; add `node test/features.mjs` to `npm test`

**Interfaces:**
- Consumes: `pageDefaults` (Task 3).
- Produces:
  - Feature names: `copy`, `download`, `edit`, `undo`, `reset`, `themes`, `edges`, `zoom`, `compare`. `undo` and `reset` turn on with `edit` unless `features` lists them explicitly.
  - `el.features` (getter: resolved `string[]`; setter: array or space-separated string, reflected to the attribute).
  - Resolution: `features` attribute (`"none"` → `[]`) → `controls` shorthand (`zoom copy download`, `formats="png svg"`) → `pageDefaults.features` → `['copy', 'download']`. `zoom` implies `pannable` behaviour.
  - `formats` attribute or `pageDefaults.formats`, from `png svg md`, default `png`. One format: a Download button. Several: a Download menu. `md` = the source in a ```` ```mermaid ```` fence, block included.
  - Copy copies a PNG through `ClipboardItem`. Where that's unavailable or refused, it shows `Copying isn't available here` in the diagram's note and doesn't throw.
  - Toolbar `part="toolbar"`: shown on `:hover` and `:focus-within`; always shown when `(hover: none)`. Buttons carry `aria-label`s.

- [ ] **Step 1: Write the failing tests** (`test/features.html` has `#plain` with no attributes, `#none` with `features="none"`, `#legacy` with `controls pannable`, `#fmt` with `formats="png svg md"`, `#zoom` with `features="zoom"`):

```js
ok('default shows Copy and Download only', await buttons('#plain') === 'Copy,Download');
ok('features="none" shows no toolbar', await hidden('#none .toolbar'));
ok('controls keeps zoom, Fit and Export', await buttons('#legacy') === '−,+,Fit,Export');
ok('several formats make a Download menu', await menuItems('#fmt') === 'PNG,SVG,Markdown');
ok('zoom implies a pannable canvas', await isPannable('#zoom'));
ok('download saves a PNG named after the diagram', (await download('#plain')).suggestedFilename() === 'my-wermaid.png');
ok('markdown download fences the source', /^```mermaid\n[\s\S]*%% @layout/.test(await downloadText('#fmt', 'md')));
ok('copy without ClipboardItem shows a note', await copyWithoutClipboard('#plain') === "Copying isn't available here");
ok('toolbar appears on keyboard focus', await focusShowsToolbar('#plain'));
```

- [ ] **Step 2:** Run `node test/features.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement as given in Interfaces, reusing the element's existing export and save code (`window.claude` save path included).
- [ ] **Step 4:** Run `npm test`. Expected: all PASS (`embed.mjs` keeps its `controls` expectations).
- [ ] **Step 5:** Commit: `Element: features, formats, Copy and Download toolbar`.

---

### Task 5b: Editing, pickers and change events in the element

**Files:**
- Modify: `src/element.js`
- Modify: `build.mjs` (embed demo inlines `edit.js`)
- Test: `test/features.html`, `test/features.mjs`

**Interfaces:**
- Consumes: `createEditor`, `createHistory` (Task 4); features (Task 5); `listThemes` (Task 2).
- Produces:
  - `edit`: a `createEditor` attached to the shadow stage. Key handling only while focus is inside this element (the element is focusable, `tabindex="0"`).
  - `undo` (buttons plus Ctrl/⌘ Z and Shift+Ctrl/⌘ Z), `reset` (back to the source as supplied), `compare` (`aria-pressed` toggle using `setStock`).
  - `themes` picker: the options are the `themes` attribute's names (registered ones only), else `listThemes()`. A pick writes `%% @theme` to the block and re-renders. The `edges` picker writes `%% @edges`.
  - `el.editedSource: string`, the source with the current block.
  - Event `wermaid:change`, `detail: { source: string, reason: 'drag'|'key'|'reset'|'undo'|'redo'|'pin'|'style'|'theme'|'edges' }`, bubbling and composed, once per completed change.

- [ ] **Step 1: Write the failing tests** (`#ed` has `features="edit themes edges compare"` and a three-node flowchart; `#ed2` is a second editable diagram):

```js
await dragNode('#ed', 'B', 0, 60);
ok('drag nudges and fires one change', changes.length === 1 && changes[0].reason === 'drag' && /%% B\s+nudge 0,\d+/.test(changes[0].source));
ok('editedSource matches the event', await p.$eval('#ed', (e) => e.editedSource) === changes[0].source);
await p.keyboard.press(`${MOD}+z`);
ok('undo restores and reports', last().reason === 'undo' && !/%% B\s+nudge/.test(last().source));
await pickTheme('#ed', 'pele');
ok('theme pick writes @theme', /%% @theme pele/.test(last().source) && await themeOf('#ed') === 'pele');
const edBefore = await editedSource('#ed');
await clickNode('#ed2', 'B'); await p.keyboard.press('ArrowRight');
ok('keys only move the focused diagram', /%% B\s+nudge 1,0/.test(await editedSource('#ed2')) && await editedSource('#ed') === edBefore);
await p.$eval('#ed', (e) => { e.source = 'flowchart LR\n  X --> Y'; });
ok('new source drops a stale selection without errors', pageErrors.length === 0 && await selectionOf('#ed') === null);
await dragNode('#ed', 'X', 0, 40); await p.click('#ed >> [data-act="compare"]');
ok('compare shows the stock layout', await p.$eval('#ed', (e) => e.diagram.geometry.nodes.get('X').delta.y) === 0
  && await p.$eval('#ed >> [data-act="compare"]', (b) => b.getAttribute('aria-pressed')) === 'true');
```

- [ ] **Step 2:** Run `node test/features.mjs`. Expected: the new lines FAIL.
- [ ] **Step 3:** Implement as given in Interfaces.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `Element: inline editing, undo, reset, compare, theme and edge pickers, change events`.

---

### Task 6: Keeping adjustments

**Files:**
- Modify: `src/element.js` (or a new `src/persist.js` imported by it)
- Test: `test/features.html`, `test/features.mjs`

**Interfaces:**
- Consumes: `wermaid:change` and reset (Task 5b), `pageDefaults.persist` (Task 3).
- Produces:
  - On when `edit` is on, unless `persist="off"` or `pageDefaults.persist === false`.
  - Key: the `persist-key` attribute, else a hash of the supplied source after dedent, `\r\n` → `\n`, and trimming. Storage key `wermaid:layout:<key>`; value `{ block: string, used: number }`, where `block` is the serialized layout block.
  - On render, a stored block replaces the supplied block. Reset deletes the entry.
  - Index `wermaid:layout:index` keeps the 200 most recently used keys, evicting the least recently used.
  - Every storage call sits in try/catch; failures turn persistence off for that element and nothing else.

- [ ] **Step 1: Write the failing tests:**

```js
await dragNode('#ed', 'B', 0, 60); await p.reload(); await ready();
ok('adjustment survives a reload', /%% B\s+nudge 0,\d+/.test(await editedSource('#ed')));
ok('persist key ignores indentation and line endings', await sameKey(indentedCRLF, plain));
ok('persist-key separates identical diagrams', await keysDiffer('#twin-a', '#twin-b'));
await reset('#ed'); await p.reload(); await ready();
ok('reset clears the stored layout', !/%% B\s+nudge/.test(await editedSource('#ed')));
ok('persist="off" stores nothing', await storedFor('#off') === null);
ok('only 200 layouts kept', await fillAndCount(205) === 200);
ok('edit works when localStorage throws', await withThrowingStorage(() => dragNode('#ed', 'B', 0, 40)) && pageErrors.length === 0);
```

- [ ] **Step 2:** Run `node test/features.mjs`. Expected: the new lines FAIL.
- [ ] **Step 3:** Implement as given in Interfaces.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `Element: keep users' adjustments in the browser`.

---

### Task 7: Watching pages and streamed answers

**Files:**
- Modify: `src/element.js` (`run`, `streaming` attribute)
- Create: `test/watch.html`, `test/watch.mjs`; add to `npm test`

**Interfaces:**
- Produces:
  - `run({ root, selector, attributes, watch = false, settle = 400 }): Promise<PromiseSettledResult[]> & { stop(): void }`. Without `watch`, behaviour is unchanged. With `watch`, a `MutationObserver` on `root` upgrades matching blocks as they appear; blocks present at start render at once.
  - Settling: a new or changing block renders after `settle` ms with no change to its text. The timer is keyed by the block's message (the nearest ancestor that is a direct child of `root`) and its index among blocks in that message, so a recreated `<pre>` keeps its timer.
  - A render cache (`Map` of source → rendered SVG and diagram state) lets a block that reappears with identical source reuse the drawing without calling Mermaid.
  - `streaming` attribute: while present, the element renders nothing and shows no error; on removal it renders at once.

- [ ] **Step 1: Write the failing tests:**

```js
await appendChunks('#chat', mermaidChunks, 50);          // append text to one <pre>, 50 ms apart
ok('streamed block renders once after settling', renderCount() === 1);
await rebuildChunks('#chat2', mermaidChunks, 50);        // innerHTML replaced on every chunk
ok('innerHTML-rebuilt message renders once', renderCount2() === 1);
await rebuildSame('#chat2');
ok('unchanged block reuses the cached drawing', mermaidCalls() === callsBefore);
await appendChunks('#chat3', invalidChunks, 50);
ok('invalid final source shows one error after settling', errorEvents() === 1 && await errorShown('#chat3'));
ok('static blocks render without waiting', await renderedWithin('#static', 100));
await p.$eval('#s', (e) => e.removeAttribute('streaming'));
ok('removing streaming renders at once', await renderedWithin('#s', 100) && errorEventsFor('#s') === 0);
```

- [ ] **Step 2:** Run `node test/watch.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement as given in Interfaces.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `run({ watch }): upgrade blocks as they stream in; streaming attribute`.

---

### Task 8: One-line setup and React helpers

**Files:**
- Create: `src/auto.js`, `src/react.js`
- Test: `test/watch.html` (an `auto.js` page), `test/react.html`, plus lines in `test/watch.mjs`

**Interfaces:**
- Produces:
  - `src/auto.js`: reads its own `<script>` tag through `import.meta.url`, matched against `document.querySelectorAll('script[type=module][src]')`. Options from `data-*`: `data-features`, `data-formats`, `data-theme`, `data-persist`, `data-mermaid` (URL; default `https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs`), `data-watch` (default `true`). Imports Mermaid, calls `defineWermaidElement(mermaid, { defaults })`, then `run({ watch })`. Exports `ready: Promise<void>`.
  - `src/react.js`: `export function createMermaidBlock(React, { features, formats, theme } = {})` returns a component `({ className, children, streaming }) => ReactElement`. For `language-mermaid` it renders `React.createElement('wermaid-diagram', { features: features?.join(' '), formats: formats?.join(' '), theme, streaming: streaming ? '' : undefined }, String(children))`. Anything else renders `<code className>`. It has no imports.

- [ ] **Step 1: Write the failing tests:**

```js
ok('auto.js upgrades blocks with script options', await features('#auto-block') === 'copy download edit');
ok('auto.js watches for new blocks', await appendedBlockRenders());
const r = await reactRender({ className: 'language-mermaid', children: 'flowchart LR\n  A --> B', streaming: true });
ok('react helper returns wermaid-diagram for mermaid', r.type === 'wermaid-diagram' && r.props.streaming === '');
ok('react helper leaves other code alone', (await reactRender({ className: 'language-js', children: 'x' })).type === 'code');
```

`reactRender` calls `createMermaidBlock` with a stub `React = { createElement: (type, props, ...c) => ({ type, props: { ...props, children: c } }) }`, so the test needs no React download.

- [ ] **Step 2:** Run `node test/watch.mjs`. Expected: the new lines FAIL.
- [ ] **Step 3:** Implement as given in Interfaces.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `auto.js one-line setup; react.js code-block helper`.

---

### Task 9: Theme builder in the editor

**Files:**
- Modify: `src/editor.html`
- Test: `test/interact.mjs` (new section)

**Interfaces:**
- Consumes: `defineTheme`, `listThemes`, `getTheme` (Task 2).
- Produces:
  - A **Theme** button in the header (`#theme-btn`) opens a panel (`#theme-panel`) beside the diagram, with controls for every `ThemeSpec` field and the theme's name (`#theme-name`, pattern from Task 2).
  - Colour controls are in two columns, light and dark, side by side. Dark values start as derived (shown as placeholders), and typing one overrides it. A switch (`#theme-mode-light`, `#theme-mode-dark`) chooses which variant the diagram previews.
  - Each change calls `defineTheme(name, spec)` and re-renders. The palette picker lists the theme, and the diagram's block gets `%% @theme <name>`.
  - **Copy code** writes `defineTheme('<name>', <spec JSON, 2-space indent>);`. **Copy JSON** writes the spec alone. **Paste** (`#theme-paste`, a textarea plus an Import button) accepts either form.
  - Specs being edited persist in `localStorage` under `wermaid:themes:v1` (`{ [name]: spec }`) and are registered at startup.
  - A spacing change shows: `Spacing changes Mermaid's layout, so nudged shapes move with it.`

- [ ] **Step 1: Write the failing tests:**

```js
await p.click('#theme-btn'); await p.fill('#theme-name', 'acme'); await setColor('nodeFill', '#ffeedd');
ok('theme builder previews on the diagram', await nodeFill() === 'rgb(255, 238, 221)');
ok('theme builder writes @theme', /%% @theme acme/.test(await src()));
ok('copy code is a defineTheme call', /^defineTheme\('acme', \{[\s\S]*"nodeFill": "#ffeedd"[\s\S]*\}\);$/.test(await copyCode()));
await p.reload(); await ready();
ok('themes survive a reload', (await paletteOptions()).includes('acme'));
await importTheme(`{ "label": "Beta", "colors": { "nodeFill": "#ddeeff" } }`, 'beta');
ok('pasted JSON imports a theme', (await paletteOptions()).includes('beta'));
await p.click('#theme-mode-dark');
ok('dark preview uses the dark variant', await sheetIsDark());
```

- [ ] **Step 2:** Run `npm run build && node test/interact.mjs`. Expected: the new lines FAIL.
- [ ] **Step 3:** Implement as given in Interfaces, in the editor's drafting-sheet style (hairline plates, mono controls).
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `Editor: theme builder with live preview, copy code and import`.

---

### Task 10: Documentation for CDN-only use

**Files:**
- Modify: `README.md`, `package.json` (`"version": "0.4.0"`; `description` mentions CDN use), `src/embed-demo.html` (shows `features`, `themes` and `defineTheme`)

**Interfaces:**
- Consumes: everything above. Docs pin imports to `https://cdn.jsdelivr.net/gh/LandoCole/Wermaid@v0.4.0/src/...`.

- [ ] **Step 1:** README: remove the "With npm" lines. Add sections for themes (`defineTheme`, spec table, precedence, dark, spacing), element features (table from the spec, `formats`, `features="none"`, `controls` shorthand), events (`wermaid:change`, `editedSource`), keeping adjustments, chat and streaming (`run({ watch })`, `streaming`, `auto.js`), React (React 19 and 18 usage, the react-markdown/Streamdown code-slot recipe, `createMermaidBlock`), and the theme builder.
- [ ] **Step 2:** Run `npm run build && npm test`. Expected: all PASS.
- [ ] **Step 3:** Commit: `README and demo: themes, features, chat and React; CDN-only`.

---

### Task 11: wermaid.com update and release (needs the owner's go-ahead)

**Files (repo `wermaid-site`):**
- Modify: `build.mjs` (copy every `vendor/wermaid/src/*.js` to `/lib`; keep the editor header patch working)
- Modify: `site/index.html` (`features="none"` on both `.stage .layer` diagrams; docs sections for themes, features, chat and React, with live examples using `features`), `site/docs.js` as needed

- [ ] **Step 1:** Show the owner the Wermaid repo changes (summary plus local preview). After approval: push `main`, then create and push tag `v0.4.0`.
- [ ] **Step 2:** In `wermaid-site`: `git submodule update --remote vendor/wermaid` (at `v0.4.0`), make the changes above, then `node build.mjs`. Expected: `built wermaid.com (wermaid 0.4.0)`, no `editor: expected one …` error.
- [ ] **Step 3:** Preview locally: Fig. 1 shows no toolbar; the docs examples' features work; `/editor` has the Theme panel; no console errors at desktop and phone widths. Send the owner screenshots.
- [ ] **Step 4:** After approval: commit, push, wait for the Vercel deploy, and check wermaid.com serves `0.4.0` (`/lib/wermaid.js` contains `VERSION = '0.4.0'`) with no console errors.
