import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8765' });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto('http://127.0.0.1:8765/dist/local.html?mermaid=/mermaid-dist/mermaid.esm.min.mjs');
await p.waitForFunction(() => window.READY);
const R = []; const ok = (n, c, x) => R.push(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(x)}`);

async function pick(kind) { await p.click('#export-btn'); await p.click(`[data-export="${kind}"]`); }
async function download(kind) {
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), pick(kind)]);
  const path = await d.path();
  return { name: d.suggestedFilename(), buf: fs.readFileSync(path) };
}

ok('menu opens with five items', await (async () => { await p.click('#export-btn'); const n = await p.$$eval('#export-menu button', (b) => b.length); const vis = await p.isVisible('#export-menu'); await p.keyboard.press('Escape'); return n === 5 && vis; })());
ok('Escape closes the menu', !(await p.isVisible('#export-menu')));

const png = await download('save-png');
const dims = png.buf.length > 24 ? [png.buf.readUInt32BE(16), png.buf.readUInt32BE(20)] : null;
ok('Save as PNG downloads a real PNG at 2x', png.name === 'order-pipeline.png' && png.buf.slice(1, 4).toString() === 'PNG' && dims && dims[0] > 1500, { name: png.name, dims });

const svg = await download('save-svg');
const svgText = svg.buf.toString();
ok('Save as SVG downloads clean SVG', svg.name === 'order-pipeline.svg' && svgText.startsWith('<svg') && svgText.includes('xmlns="http://www.w3.org/2000/svg"') && !svgText.includes('wm-overlay') && !svgText.includes('wm-hit'), svgText.slice(0, 120));

const md = await download('save-md');
const mdText = md.buf.toString();
ok('Save as Markdown wraps the source in a mermaid fence', md.name === 'order-pipeline.md' && mdText.startsWith('# Order pipeline') && mdText.includes('```mermaid\nflowchart LR') && mdText.includes('%% @layout v1') && mdText.trim().endsWith('```'), mdText.slice(0, 200));

await pick('copy-png'); await p.waitForTimeout(800);
const types = await p.evaluate(async () => { const items = await navigator.clipboard.read(); return items.flatMap((i) => i.types); });
ok('Copy as PNG puts an image on the clipboard', types.includes('image/png'), types);
const pngSize = await p.evaluate(async () => { const [item] = await navigator.clipboard.read(); return (await item.getType('image/png')).size; });
ok('copied PNG is non-empty', pngSize > 1000, pngSize);

await pick('copy-svg'); await p.waitForTimeout(300);
const clip = await p.evaluate(() => navigator.clipboard.readText());
ok('Copy as SVG puts SVG text on the clipboard', clip.startsWith('<svg') && !clip.includes('wm-hit'), clip.slice(0, 80));

// Renaming the diagram names the exports, and the name is saved in the source as @title.
const src = () => p.$eval('#src', (e) => e.value);
await p.click('#title');
await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.type('Checkout flow v2'); await p.keyboard.press('Enter');
await p.waitForTimeout(300);
ok('renaming writes %% @title into the layout block', /%% @layout v1\n%% @title Checkout flow v2\n/.test(await src()), (await src()).split('%% @layout')[1]);
ok('the title shows the new name', (await p.textContent('#title')) === 'Checkout flow v2' && (await p.textContent('#figcap')).includes('Checkout flow v2'));
const rpng = await download('save-png');
const rmd = await download('save-md');
ok('exports are named after it', rpng.name === 'checkout-flow-v2.png' && rmd.name === 'checkout-flow-v2.md' && rmd.buf.toString().startsWith('# Checkout flow v2'), [rpng.name, rmd.name]);
await p.click('#reset-all').catch(() => {}); await p.waitForTimeout(200);
ok('Clear overrides keeps the name', /%% @title Checkout flow v2/.test(await src()));
await p.click('#undo'); await p.waitForTimeout(200);
// Escape cancels an edit; Undo brings back the old name; clearing the name falls back to the example's.
await p.click('#title'); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.type('Nope'); await p.keyboard.press('Escape');
await p.waitForTimeout(200);
ok('Escape cancels a rename', (await p.textContent('#title')) === 'Checkout flow v2' && !/@title Nope/.test(await src()));
await p.click('#title'); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('Backspace'); await p.keyboard.press('Enter');
await p.waitForTimeout(300);
ok('an empty name falls back to the example name', (await p.textContent('#title')) === 'Order pipeline' && !/@title/.test(await src()), await p.textContent('#title'));
await p.click('#undo'); await p.waitForTimeout(300);
ok('undo restores the name', (await p.textContent('#title')) === 'Checkout flow v2', await p.textContent('#title'));
await p.click('#title'); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('Backspace'); await p.keyboard.press('Enter');
await p.waitForTimeout(300);

// Clearing the example clears its name too; a new diagram is called my-wermaid until renamed.
await p.click('#title'); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.type('Renamed pipeline'); await p.keyboard.press('Enter');
await p.waitForTimeout(300);
await p.click('#src'); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('Backspace');
await p.waitForTimeout(500);
ok('clearing the source resets the name to my-wermaid', (await p.textContent('#title')) === 'my-wermaid', await p.textContent('#title'));
await p.keyboard.type('flowchart LR\n  A --> B\n'); await p.waitForTimeout(1200);
const fresh = await download('save-png');
ok('a new diagram exports as my-wermaid', (await p.textContent('#title')) === 'my-wermaid' && fresh.name === 'my-wermaid.png', [await p.textContent('#title'), fresh.name]);
await p.selectOption('#example', '0'); await p.waitForTimeout(1200);
ok('picking an example again shows its name', (await p.textContent('#title')) === 'Order pipeline', await p.textContent('#title'));

// dark palette + pele background flows into the PNG

console.log(R.join('\n'));
await b.close();
