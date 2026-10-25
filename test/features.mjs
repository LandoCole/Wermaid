import { chromium } from 'playwright';
const BASE = `http://127.0.0.1:${process.env.WERMAID_TEST_PORT || 8765}`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const pageErrors = [];
p.on('pageerror', (e) => { pageErrors.push(e.message); console.log('PAGEERR', e.message); });
// Every wermaid:change on the page, in order.
const changes = [];
await p.exposeFunction('onWermaidChange', (detail) => { changes.push(detail); });
// Start from no stored layouts, so a run never depends on the one before it.
const forgetLayouts = () => p.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('wermaid:layout:')) localStorage.removeItem(k);
});
await p.goto(BASE + '/test/features.html');
await forgetLayouts();
await p.reload();
await p.waitForFunction(() => window.READY, null, { timeout: 30000 });
await p.waitForTimeout(300);
const R = []; const ok = (n, c, x) => R.push(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(x)}`);

// The text of each visible toolbar button (its aria-label when it has no text), joined with ','.
const buttons = (sel) => p.$eval(sel, (e) => {
  const bar = e.shadowRoot.querySelector('.toolbar');
  const shown = (n) => !n.closest('[hidden]');
  return [...bar.querySelectorAll('button')]
    .filter((n) => shown(n) && !n.closest('.menu'))
    .map((n) => n.textContent.trim() || n.getAttribute('aria-label')).join(',');
});
const hidden = (sel) => p.locator(sel).isHidden();
// Open the Download menu and list its items.
const menuItems = async (sel) => {
  await p.locator(`${sel} >> [data-act="dlmenu"]`).click();
  const items = await p.$eval(sel, (e) => [...e.shadowRoot.querySelectorAll('.downloads .menu [role="menuitem"]')]
    .filter((n) => !n.hidden).map((n) => n.textContent.trim()).join(','));
  await p.keyboard.press('Escape');
  return items;
};
const isPannable = (sel) => p.$eval(sel, (e) => {
  const vp = e.shadowRoot.querySelector('.viewport');
  return getComputedStyle(vp).overflow === 'hidden' && vp.getBoundingClientRect().height === 240 && !!e.shadowRoot.querySelector('.zoomers:not([hidden])');
});
// Click Download (or a menu item) and return the browser download.
const download = async (sel, format) => {
  if (format) await p.locator(`${sel} >> [data-act="dlmenu"]`).click();
  const target = format ? `${sel} >> [data-act="download"][data-format="${format}"]` : `${sel} >> .download`;
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator(target).click()]);
  return dl;
};
const downloadText = async (sel, format) => (await import('node:fs')).readFileSync(await (await download(sel, format)).path(), 'utf8');
const noteOf = (sel) => p.$eval(sel, (e) => e.shadowRoot.querySelector('.note').textContent);
const copyWithoutClipboard = async (sel) => {
  await p.evaluate(() => { window.ClipboardItem = undefined; });
  await p.locator(`${sel} >> .copy`).click();
  return noteOf(sel);
};
const opacity = (sel) => p.$eval(sel, (e) => getComputedStyle(e.shadowRoot.querySelector('.toolbar')).opacity);
const focusShowsToolbar = async (sel) => {
  await p.mouse.move(2, 2);
  await p.focus('#start');
  const before = await opacity(sel);
  await p.keyboard.press('Tab');
  return before === '0' && await opacity(sel) === '1';
};

ok('default shows Copy and Download only', await buttons('#plain') === 'Copy,Download', await buttons('#plain'));
ok('features="none" shows no toolbar', await hidden('#none .toolbar'));
ok('controls keeps zoom, Fit and Export', await buttons('#legacy') === '−,+,Fit,Export', await buttons('#legacy'));
ok('several formats make a Download menu', await menuItems('#fmt') === 'PNG,SVG,Markdown', await menuItems('#fmt'));
ok('zoom implies a pannable canvas', await isPannable('#zoom'));
ok('the zoom feature alone shows only the zoom buttons', await buttons('#zoom') === '−,+,Fit', await buttons('#zoom'));
ok('download saves a PNG named after the diagram', (await download('#plain')).suggestedFilename() === 'my-wermaid.png');
const md = await downloadText('#fmt', 'md');
ok('markdown download fences the source', /^```mermaid\n[\s\S]*%% @layout/.test(md), md);
ok('markdown download closes the fence', /\n```\n$/.test(md), md);
ok('SVG download is an SVG file', /^<svg/.test(await downloadText('#fmt', 'svg')));
ok('copy without ClipboardItem shows a note', await copyWithoutClipboard('#plain') === "Copying isn't available here");
ok('a refused copy shows the note and does not throw', await (async () => {
  await p.evaluate(() => { window.ClipboardItem = class { constructor() {} }; Object.defineProperty(navigator, 'clipboard', { value: { write: () => Promise.reject(new DOMException('no', 'NotAllowedError')) }, configurable: true }); });
  await p.locator('#plain >> .copy').click();
  await p.waitForTimeout(100);
  return await noteOf('#plain') === "Copying isn't available here" && pageErrors.length === 0;
})());
ok('toolbar appears on keyboard focus', await focusShowsToolbar('#plain'));
ok('toolbar appears on hover', await (async () => {
  await p.mouse.move(2, 2);
  const before = await opacity('#fmt');
  const box = await (await p.$('#fmt')).boundingBox();
  await p.mouse.move(box.x + 20, box.y + 20);
  return before === '0' && await opacity('#fmt') === '1';
})());
ok('classic controls toolbar stays visible', await opacity('#legacy') === '1');

// Feature resolution.
const feats = (attrs, setup) => p.evaluate(({ attrs, setup }) => {
  const e = document.createElement('wermaid-diagram');
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (setup) new Function('e', setup)(e);
  return e.features;
}, { attrs, setup });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok('default features', same(await feats({}), ['copy', 'download']));
ok('features="none" is empty', same(await feats({ features: 'none' }), []));
ok('controls means zoom copy download', same(await feats({ controls: '' }), ['zoom', 'copy', 'download']));
ok('features beats controls', same(await feats({ controls: '', features: 'copy' }), ['copy']));
ok('edit brings undo and reset', same(await feats({ features: 'edit themes' }), ['edit', 'themes', 'undo', 'reset']));
ok('listing undo explicitly keeps reset off', same(await feats({ features: 'edit undo' }), ['edit', 'undo']));
ok('unknown names are dropped', same(await feats({ features: 'copy bogus' }), ['copy']));
ok('the setter takes an array and reflects it', same(await feats({}, "e.features = ['zoom', 'copy']; if (e.getAttribute('features') !== 'zoom copy') throw new Error('not reflected')"), ['zoom', 'copy']));
ok('the setter takes a string; an empty array is none', same(await feats({}, "e.features = 'copy zoom'"), ['copy', 'zoom']) && same(await feats({}, 'e.features = []'), []));
ok('changing features updates the toolbar', await (async () => {
  await p.$eval('#plain', (e) => { e.features = 'copy'; });
  const one = await buttons('#plain');
  await p.$eval('#plain', (e) => { e.features = 'copy download'; });
  return one === 'Copy' && await buttons('#plain') === 'Copy,Download';
})());
ok('the toolbar buttons have accessible names', await p.$eval('#fmt', (e) => [...e.shadowRoot.querySelectorAll('.toolbar button')].every((n) => n.getAttribute('aria-label') || n.textContent.trim())));

// Editing, pickers and change events.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const last = () => changes.at(-1) ?? {};
const settle = () => p.waitForTimeout(150);
const rendered = (sel) => p.$eval(sel, (e) => e.rendered.then(() => true, () => false));
// A node's centre on screen, scrolled into view.
const nodeCentre = async (sel, id) => {
  await rendered(sel);
  await p.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
  return p.$eval(sel, (e, id) => {
    const r = e.diagram.scene.nodes.get(id).el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
};
const dragNode = async (sel, id, dx, dy) => {
  const c = await nodeCentre(sel, id);
  await p.mouse.move(c.x, c.y);
  await p.mouse.down();
  await p.mouse.move(c.x + dx, c.y + dy, { steps: 8 });
  await p.mouse.up();
  await settle();
};
const clickNode = async (sel, id) => {
  const c = await nodeCentre(sel, id);
  await p.mouse.click(c.x, c.y);
  await settle();
};
const pickTheme = async (sel, name) => {
  await p.locator(`${sel} >> [data-act="theme"]`).selectOption(name);
  await rendered(sel);
  await settle();
};
const pickEdges = async (sel, value) => {
  await p.locator(`${sel} >> [data-act="edges"]`).selectOption(value);
  await settle();
};
const themeOf = async (sel) => { await rendered(sel); return p.$eval(sel, (e) => e.diagram.theme); };
const editedSource = (sel) => p.$eval(sel, (e) => e.editedSource);
const selectionOf = async (sel) => { await rendered(sel); return p.$eval(sel, (e) => e._editor?.selection ?? null); };

ok('edit shows Undo, Redo, Reset, the pickers and compare', await buttons('#ed') === 'Undo,Redo,Reset,Mermaid’s layout'
  && await p.$eval('#ed', (e) => !!e.shadowRoot.querySelector('[data-act="theme"]:not([hidden])') && !!e.shadowRoot.querySelector('[data-act="edges"]:not([hidden])')), await buttons('#ed'));
ok('an editable diagram is focusable', await p.$eval('#ed', (e) => e.tabIndex === 0) && await p.$eval('#plain', (e) => !e.hasAttribute('tabindex')));
await dragNode('#ed', 'B', 0, 60);
ok('drag nudges and fires one change', changes.length === 1 && changes[0]?.reason === 'drag' && /%% B\s+nudge 0,\d+/.test(changes[0].source), changes);
ok('editedSource matches the event', await p.$eval('#ed', (e) => e.editedSource) === changes[0]?.source);
await p.keyboard.press(`${MOD}+z`);
await settle();
ok('undo restores and reports', last().reason === 'undo' && !/%% B\s+nudge/.test(last().source), last());
await p.keyboard.press(`Shift+${MOD}+z`);
await settle();
ok('redo brings the change back', last().reason === 'redo' && last().source === changes[0].source && await editedSource('#ed') === changes[0].source, last());
await p.locator('#ed >> [data-act="undo"]').click();
await settle();
ok('the Undo button undoes', last().reason === 'undo' && !/nudge/.test(await editedSource('#ed')), last());
await pickTheme('#ed', 'pele');
ok('theme pick writes @theme', /%% @theme pele/.test(last().source) && await themeOf('#ed') === 'pele', last());
ok('the theme picker shows the theme in use', await p.$eval('#ed', (e) => e.shadowRoot.querySelector('[data-act="theme"]').value) === 'pele');
ok('the theme picker lists every registered theme', await p.$eval('#ed', (e) => [...e.shadowRoot.querySelector('[data-act="theme"]').options].map((o) => o.value).join(',')) === 'mermaid,wermaid,pele');
await p.locator('#ed >> [data-act="undo"]').click();
ok('undoing a theme pick re-renders with the earlier theme', last().reason === 'undo' && await themeOf('#ed') === 'wermaid'
  && await p.$eval('#ed', (e) => e.shadowRoot.querySelector('[data-act="theme"]').value) === 'wermaid', last());
await p.locator('#ed >> [data-act="redo"]').click();
ok('redoing it brings the pick back', last().reason === 'redo' && await themeOf('#ed') === 'pele', last());
// A pick undone while its render is still running: the drawing must catch up with the text.
const settled = (sel) => p.$eval(sel, async (e) => {
  let r;
  do { r = e.rendered; await r.catch(() => {}); await new Promise((res) => setTimeout(res, 50)); } while (r !== e.rendered);
});
await p.$eval('#ed', async (e) => {
  const pick = e.shadowRoot.querySelector('[data-act="theme"]');
  pick.value = 'mermaid';
  pick.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((res) => setTimeout(res));
  e.shadowRoot.querySelector('[data-act="undo"]').click();
});
await settled('#ed');
ok('an undo during a theme render leaves drawing and text agreeing', await p.$eval('#ed', (e) => e.diagram.theme) === 'pele'
  && /%% @theme pele/.test(await editedSource('#ed')), [await p.$eval('#ed', (e) => e.diagram.theme), await editedSource('#ed')]);
const before = changes.length;
await dragNode('#ed', 'A', 0, 40);
ok('a drag after that is recorded', changes.length === before + 1 && last().reason === 'drag' && /%% A\s+nudge 0,\d+/.test(last().source), last());
ok('the themes attribute limits the picker to registered names', await p.$eval('#ed2', (e) => [...e.shadowRoot.querySelector('[data-act="theme"]').options].map((o) => o.value).join(',')) === 'pele,wermaid');
await pickEdges('#ed', 'orthogonal');
ok('edge-look pick writes @edges', last().reason === 'edges' && /%% @edges orthogonal/.test(last().source) && /%% @theme pele/.test(last().source), last());
await pickEdges('#ed', 'mermaid');
ok('Mermaid curves write @edges mermaid', /%% @edges mermaid/.test(last().source), last());
await pickEdges('#ed', '');
ok('theme default removes @edges', last().reason === 'edges' && !/@edges/.test(last().source), last());
const edBefore = await editedSource('#ed');
await clickNode('#ed2', 'B'); await p.keyboard.press('ArrowRight');
await settle();
ok('keys only move the focused diagram', /%% B\s+nudge 1,0/.test(await editedSource('#ed2')) && await editedSource('#ed') === edBefore, await editedSource('#ed2'));
ok('a key nudge reports once', last().id === 'ed2' && last().reason === 'key', last());
const edMd = await downloadText('#ed2', 'md');
ok('markdown export carries the edits', /%% B\s+nudge 1,0/.test(edMd), edMd);
await p.locator('#ed2 >> [data-act="reset"]').click();
await settle();
ok('reset returns to the source as supplied', last().reason === 'reset' && last().source === 'flowchart LR\n  A --> B --> C' && await editedSource('#ed2') === last().source, last());
ok('reset clears the history', await p.$eval('#ed2', (e) => e.shadowRoot.querySelector('[data-act="undo"]').getAttribute('aria-disabled')) === 'true');
await p.$eval('#ed', (e) => { e.source = 'flowchart LR\n  X --> Y'; });
ok('new source drops a stale selection without errors', pageErrors.length === 0 && await selectionOf('#ed') === null, pageErrors);
ok('a new source is what editedSource shows', await editedSource('#ed') === 'flowchart LR\n  X --> Y');
await dragNode('#ed', 'X', 0, 40); await p.click('#ed >> [data-act="compare"]');
ok('compare shows the stock layout', await p.$eval('#ed', (e) => e.diagram.geometry.nodes.get('X').delta.y) === 0
  && await p.$eval('#ed >> [data-act="compare"]', (b) => b.getAttribute('aria-pressed')) === 'true');
await p.click('#ed >> [data-act="compare"]');
ok('compare off shows the edited layout again', await p.$eval('#ed', (e) => e.diagram.geometry.nodes.get('X').delta.y) > 0);
ok('the editing controls have accessible names', await p.$eval('#ed', (e) => [...e.shadowRoot.querySelectorAll('.toolbar button, .toolbar select')].every((n) => n.getAttribute('aria-label') || n.textContent.trim())));

// Keeping adjustments in the browser.
const ready = async () => {
  await p.waitForFunction(() => window.READY, null, { timeout: 30000 });
  await p.waitForTimeout(300);
};
const reset = async (sel) => {
  await p.locator(`${sel} >> [data-act="reset"]`).click();
  await settle();
};
// The stored entry for a diagram, parsed, or null: looked up the way the element names it.
const storedFor = (sel) => p.$eval(sel, async (e) => {
  const m = await import('/src/persist.js');
  const raw = localStorage.getItem('wermaid:layout:' + (e.getAttribute('persist-key') || m.sourceKey(e._supplied)));
  return raw === null ? null : JSON.parse(raw);
});
const layoutCount = () => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wermaid:layout:') && k !== 'wermaid:layout:index').length);
// Add an editable diagram to the page, wait for it to draw.
const mount = async (id, source, attrs = {}) => {
  await p.evaluate(({ id, source, attrs }) => {
    const e = document.createElement('wermaid-diagram');
    e.id = id; e.setAttribute('features', 'edit');
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    document.body.append(e);
    e.source = source;
  }, { id, source, attrs });
  await rendered('#' + id);
};
const unmount = (id) => p.evaluate((id) => document.getElementById(id)?.remove(), id);
// Two spellings of one diagram share an entry: adjust the first, the second comes up adjusted.
const sameKey = async (a, b) => {
  await mount('key-a', a);
  await dragNode('#key-a', 'K', 0, 40);
  await mount('key-b', b);
  const shared = /%% K\s+nudge 0,\d+/.test(await editedSource('#key-b'));
  await unmount('key-a'); await unmount('key-b');
  return shared;
};
// Identical sources with different persist-keys do not share: adjust one, reload, the other is untouched.
const keysDiffer = async (a, b) => {
  await dragNode(a, 'B', 0, 50);
  await p.reload(); await ready();
  return /%% B\s+nudge 0,\d+/.test(await editedSource(a)) && !/nudge/.test(await editedSource(b));
};
// Keep n layouts through the module's own API; how many stay stored.
const fillAndCount = (n) => p.evaluate(async (n) => {
  const m = await import('/src/persist.js');
  for (const k of Object.keys(localStorage)) if (k.startsWith('wermaid:layout:')) localStorage.removeItem(k);
  const store = m.createPersistence();
  for (let i = 0; i < n; i++) store.save('fill-' + i, '%% @layout v1\n%% A  nudge 0,' + (i + 1) + '\n%% @end');
  return Object.keys(localStorage).filter((k) => k.startsWith('wermaid:layout:') && k !== 'wermaid:layout:index').length;
}, n);
// Run fn with every localStorage call throwing.
const withThrowingStorage = async (fn) => {
  await p.evaluate(() => {
    window.__ls = { get: Storage.prototype.getItem, set: Storage.prototype.setItem, del: Storage.prototype.removeItem };
    for (const k of ['getItem', 'setItem', 'removeItem']) Storage.prototype[k] = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  try { await fn(); } finally {
    await p.evaluate(() => { Storage.prototype.getItem = window.__ls.get; Storage.prototype.setItem = window.__ls.set; Storage.prototype.removeItem = window.__ls.del; });
  }
  return true;
};

await forgetLayouts();
await p.reload(); await ready();
const plainKeyed = 'flowchart LR\n  K --> L';
const indentedCRLF = '    flowchart LR\r\n      K --> L\r\n  ';
await dragNode('#ed', 'B', 0, 60);
ok('an adjustment is stored as a layout block', /^%% @layout v1[\s\S]*%% B\s+nudge 0,\d+/.test((await storedFor('#ed'))?.block ?? ''), await storedFor('#ed'));
const changesBeforeReload = changes.length;
await p.reload(); await ready();
ok('adjustment survives a reload', /%% B\s+nudge 0,\d+/.test(await editedSource('#ed')), await editedSource('#ed'));
ok('a restored layout is not announced as a change', changes.length === changesBeforeReload);
ok('reset after a reload goes back to the source as supplied', await (async () => {
  await reset('#ed');
  return last().reason === 'reset' && last().source === 'flowchart LR\n  A --> B --> C' && await storedFor('#ed') === null;
})());
ok('persist key ignores indentation and line endings', await sameKey(indentedCRLF, plainKeyed));
await dragNode('#ed', 'B', 0, 60);
await p.keyboard.press(`${MOD}+z`); await settle();
ok('undoing back to the supplied source clears the stored layout', await storedFor('#ed') === null);
await dragNode('#ed', 'A', 0, 40); await dragNode('#ed', 'B', 0, 40);
await clickNode('#ed', 'B'); await p.keyboard.press('Delete'); await settle();
ok('deleting one selection keeps the rest stored', last().reason === 'reset' && /%% A\s+nudge/.test((await storedFor('#ed'))?.block ?? '') && !/%% B\s+nudge/.test((await storedFor('#ed'))?.block ?? ''), await storedFor('#ed'));
await pickTheme('#ed', 'pele');
await p.reload(); await ready();
ok('a theme pick is kept with the layout', await themeOf('#ed') === 'pele' && /%% @theme pele/.test(await editedSource('#ed')));
await reset('#ed'); await p.reload(); await ready();
ok('reset clears the stored layout', !/%% B\s+nudge/.test(await editedSource('#ed')) && await storedFor('#ed') === null && await themeOf('#ed') === 'wermaid');
await dragNode('#twin-a', 'B', 0, 50);
ok('persist-key separates identical diagrams', await keysDiffer('#twin-a', '#twin-b'));
const storedBefore = await layoutCount();
await dragNode('#off', 'B', 0, 40);
ok('persist="off" stores nothing', await storedFor('#off') === null && /%% B\s+nudge/.test(await editedSource('#off')) && await layoutCount() === storedBefore, await layoutCount());
await p.evaluate(() => { document.querySelector('#plain').features = 'copy'; });
ok('a diagram without edit stores nothing', await storedFor('#plain') === null);
ok('a stored entry records when it was last used', typeof (await storedFor('#twin-a'))?.used === 'number');
ok('only 200 layouts kept', await fillAndCount(205) === 200);
ok('the 200 kept are the most recent', await p.evaluate(() => localStorage.getItem('wermaid:layout:fill-204') !== null && localStorage.getItem('wermaid:layout:fill-4') === null && localStorage.getItem('wermaid:layout:fill-5') !== null));
await forgetLayouts();
await p.reload(); await ready();
const errorsBefore = pageErrors.length;
ok('edit works when localStorage throws', await withThrowingStorage(() => dragNode('#ed', 'B', 0, 40)) && pageErrors.length === errorsBefore && /%% B\s+nudge 0,\d+/.test(await editedSource('#ed')), pageErrors);
ok('a diagram renders when localStorage throws', await withThrowingStorage(() => mount('late', 'flowchart LR\n  M --> N')) && pageErrors.length === errorsBefore && await p.$eval('#late', (e) => !!e.diagram));
await unmount('late');
ok('a broken store only switches persistence off for its own diagram', await (async () => {
  await dragNode('#twin-a', 'B', 0, 30);
  return (await storedFor('#twin-a'))?.block?.includes('nudge') === true;
})());

// Touch devices always show the toolbar.
const touch = await b.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
const tp = await touch.newPage();
await tp.goto(BASE + '/test/features.html');
await tp.waitForFunction(() => window.READY, null, { timeout: 30000 });
ok('toolbar is always shown without hover', await tp.$eval('#fmt', (e) => getComputedStyle(e.shadowRoot.querySelector('.toolbar')).opacity) === '1');

console.log(R.join('\n'));
await b.close();
