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

// dark palette + pele background flows into the PNG

console.log(R.join('\n'));
await b.close();
