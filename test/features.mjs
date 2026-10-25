import { chromium } from 'playwright';
const BASE = `http://127.0.0.1:${process.env.WERMAID_TEST_PORT || 8765}`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const pageErrors = [];
p.on('pageerror', (e) => { pageErrors.push(e.message); console.log('PAGEERR', e.message); });
await p.goto(BASE + '/test/features.html');
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

// Touch devices always show the toolbar.
const touch = await b.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
const tp = await touch.newPage();
await tp.goto(BASE + '/test/features.html');
await tp.waitForFunction(() => window.READY, null, { timeout: 30000 });
ok('toolbar is always shown without hover', await tp.$eval('#fmt', (e) => getComputedStyle(e.shadowRoot.querySelector('.toolbar')).opacity) === '1');

console.log(R.join('\n'));
await b.close();
