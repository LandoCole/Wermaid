import { chromium } from 'playwright';
const SHOT = process.env.SHOT_DIR || 'test/shots/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', e=>console.log('PAGEERR', e.message));
p.on('console', m=>{ if(m.type()==='error' && !m.text().includes('ERR_TUNNEL')) console.log('CONSOLE', m.text().slice(0,300)); });
await p.goto('http://127.0.0.1:8765/dist/local.html?mermaid=/mermaid-dist/mermaid.esm.min.mjs');
await p.waitForFunction(()=>window.READY, null, {timeout:30000});
const R = []; const ok = (n, c, x) => R.push(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(x)}`);
const src = () => p.$eval('#src', t => t.value);
const center = async (sel) => { const bb = await (await p.$(sel)).boundingBox(); return { x: bb.x + bb.width/2, y: bb.y + bb.height/2 }; };
async function drag(from, to, steps = 8) { await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps }); await p.mouse.up(); await p.waitForTimeout(150); }

// 1. drag a node
let c = await center('[id*="-flowchart-pay-"]');
await drag(c, { x: c.x, y: c.y - 60 });
let s = await src();
ok('node drag writes pay nudge', /%% pay\s+nudge -?\d+,-?\d+/.test(s), s.split('%% @layout')[1]);
ok('selection strip shows node', (await p.textContent('#strip')).includes('pay'));
// 2. resize via corner handle
const h = await center('.wm-overlay [data-handle="corner:se"]');
await drag(h, { x: h.x + 40, y: h.y + 20 });
s = await src();
ok('resize writes size', /%% pay\s+nudge [-\d.,]+ ; size [\d.]+x[\d.]+/.test(s), s.split('%% @layout')[1]);
// 2b. Alt-drag pins; Unpin converts back to a nudge at the same spot
c = await center('[id*="-flowchart-api-"]');
await p.keyboard.down('Alt'); await drag(c, { x: c.x + 24, y: c.y + 24 }); await p.keyboard.up('Alt');
s = await src();
ok('alt-drag pins with at', /%% api\s+at -?[\d.]+,-?[\d.]+/.test(s), s.split('%% @layout')[1]);
const before = await p.$eval('[id*="-flowchart-api-"]', (g) => g.getBoundingClientRect().x);
await p.click('#strip button:has-text("Unpin")'); await p.waitForTimeout(150);
s = await src();
const after = await p.$eval('[id*="-flowchart-api-"]', (g) => g.getBoundingClientRect().x);
ok('unpin converts to nudge without moving', /%% api\s+nudge/.test(s) && Math.abs(before - after) < 1, [s.split('%% @layout')[1], before, after]);
// 3. drag subgraph frame
const fr = await p.$('g.cluster > rect');
const fb = await fr.boundingBox();
await drag({ x: fb.x + fb.width - 8, y: fb.y + fb.height - 8 }, { x: fb.x + fb.width - 8, y: fb.y + fb.height + 40 });
s = await src();
ok('cluster drag writes nudge', /%% fulfil\s+nudge 0,\d+/.test(s), s.split('%% @layout')[1]);
// 4. bend an edge: press on the hit path midpoint of ship->notify
const hit = await p.$('path.wm-hit[data-wm-edge="L_ship_notify_0"]');
const pt = await hit.evaluate((el) => { const svg = el.ownerSVGElement; const q = el.getPointAtLength(el.getTotalLength()/2).matrixTransform(el.getScreenCTM()); return { x: q.x, y: q.y }; });
await drag(pt, { x: pt.x + 30, y: pt.y - 80 });
s = await src();
ok('edge bend writes via', /%% ship->notify\s+via \d+,\d+/.test(s), s.split('%% @layout')[1]);
// 5. double-click the bend removes it
const via = await center('.wm-overlay [data-handle="via:0"]');
await p.mouse.dblclick(via.x, via.y); await p.waitForTimeout(150);
s = await src();
ok('dblclick removes bend', !/ship->notify/.test(s), s.split('%% @layout')[1]);
// 6. label drag
const lab = await center('g.edgeLabel:has(g.label[data-id="L_valid_pay_0"])');
await drag(lab, { x: lab.x, y: lab.y - 20 });
s = await src();
ok('label drag writes label offset', /%% valid->pay\s+label 0,-\d+/.test(s), s.split('%% @layout')[1]);
await p.screenshot({ path: SHOT + 'ed2.png' });
// 7. undo x2
await p.click('.wordmark');
await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
s = await src();
ok('undo removes label offset', !/label 0,-/.test(s), s.split('%% @layout')[1]);
// 8. stock toggle
await p.click('#mode-stock'); await p.waitForTimeout(150);
const stockT = await p.$eval('[id*="-flowchart-pay-"]', (g) => g.getAttribute('transform'));
await p.click('#mode-wermaid'); await p.waitForTimeout(150);
const exT = await p.$eval('[id*="-flowchart-pay-"]', (g) => g.getAttribute('transform'));
ok('stock toggle shows stock layout', !stockT.startsWith('translate(') || stockT.split(')').length < exT.split(')').length, [stockT, exT]);
// 9. type in the source: body edit keeps overrides
await p.click('#src');
await p.keyboard.press('Control+Home');
await p.keyboard.press('End');
await p.keyboard.type('\n  api --> audit[Audit log]');
await p.waitForTimeout(900);
s = await src();
const nodes = await p.$$eval('g.node', (ns) => ns.length);
ok('body edit re-renders with new node', nodes === 9, nodes);
ok('override block kept after body edit', /%% pay\s+nudge/.test(s));
// 10. stale id warning shows
await p.$eval('#src', (t) => { t.value = t.value.replace('%% @end', '%% ghost at 1,1\n%% @end'); t.dispatchEvent(new Event('input')); });
await p.waitForTimeout(700);
ok('stale id warning shown', (await p.textContent('#messages')).includes('ghost'));
// 11. parse error keeps last render
await p.$eval('#src', (t) => { t.value = t.value.replace('flowchart LR', 'flowchart LR\n  ]]] broken'); t.dispatchEvent(new Event('input')); });
await p.waitForTimeout(700);
ok('parse error message', (await p.textContent('#messages')).includes("can't parse"));
ok('last render kept', (await p.$$eval('#sheet svg', (x) => x.length)) === 1);
// 11b. global edge style
await p.selectOption('#edge-style', 'orthogonal'); await p.waitForTimeout(200);
s = await src();
ok('edge style picker writes @edges', /%% @edges orthogonal/.test(s), s.split('%% @layout')[1]);
await p.selectOption('#edge-style', ''); await p.waitForTimeout(200);
ok('edge style picker clears @edges', !/@edges/.test(await src()));
// 11c. palette picker (fix the deliberately broken source first)
await p.$eval('#src', (t) => { t.value = t.value.replace('\n  ]]] broken', ''); t.dispatchEvent(new Event('input')); });
await p.waitForTimeout(900);
await p.selectOption('#palette', 'pele'); await p.waitForTimeout(900);
s = await src();
const fill = await p.$eval('#sheet g.node .label-container', (n) => getComputedStyle(n).fill);
ok('palette picker writes @theme and re-renders', /%% @theme pele/.test(s) && fill === 'rgb(242, 240, 229)', [fill, s.split('%% @layout')[1]]);
await p.selectOption('#palette', 'wermaid'); await p.waitForTimeout(900);
ok('choosing Wermaid removes @theme', !/@theme/.test(await src()));
// 11d. canvas: drag the background to pan in any direction, wheel pans, Ctrl+wheel zooms at the cursor
await p.selectOption('#example', '1'); await p.waitForTimeout(900);
const viewOf = () => p.$eval('#sheet', (s) => { const m = new DOMMatrix(getComputedStyle(s).transform); return [m.e, m.f]; });
const wb = await (await p.$('#sheet-wrap')).boundingBox();
const spot = await p.evaluate(({ x0, y0, w, h }) => {
  for (let y = y0 + h - 30; y > y0 + 60; y -= 15) for (let x = x0 + 30; x < x0 + w - 30; x += 15) {
    const el = document.elementFromPoint(x, y);
    if (el && (el.id === 'sheet-wrap' || el.id === 'sheet' || el.tagName === 'svg')) return { x, y };
  }
  return null;
}, { x0: wb.x, y0: wb.y, w: wb.width, h: wb.height });
let v0 = await viewOf();
await drag(spot, { x: spot.x + 120, y: spot.y - 90 }, 10);
let v1 = await viewOf();
ok('drag pans right and up', Math.abs(v1[0] - v0[0] - 120) < 2 && Math.abs(v1[1] - v0[1] + 90) < 2, [v0, v1]);
await drag(spot, { x: spot.x - 200, y: spot.y + 140 }, 10);
let v2 = await viewOf();
ok('drag pans left and down', Math.abs(v2[0] - v1[0] + 200) < 2 && Math.abs(v2[1] - v1[1] - 140) < 2, [v1, v2]);
await p.mouse.move(spot.x, spot.y);
await p.mouse.wheel(40, 60); await p.waitForTimeout(100);
let v3 = await viewOf();
ok('wheel pans both axes', Math.abs(v3[0] - v2[0] + 40) < 2 && Math.abs(v3[1] - v2[1] + 60) < 2, [v2, v3]);
await p.click('#zoom-fit'); await p.waitForTimeout(150);
const NODE_IN_VIEW = () => { const w = document.getElementById('sheet-wrap').getBoundingClientRect(); for (const n of document.querySelectorAll('#sheet g.node')) { const r = n.getBoundingClientRect(); const c = { x: r.x + r.width / 2, y: r.y + r.height / 2, id: n.id }; if (c.x > w.x + 40 && c.x < w.right - 40 && c.y > w.y + 60 && c.y < w.bottom - 40) return c; } return null; };
const anchor = await p.evaluate(NODE_IN_VIEW);
const z0 = await p.textContent('#zoom-val');
await p.evaluate(() => document.getElementById('sheet-wrap').addEventListener('wheel', (e) => { window.LASTW = { ctrl: e.ctrlKey, dy: e.deltaY, t: e.target.tagName + '.' + e.target.className }; }, true));
await p.mouse.move(anchor.x, anchor.y);
await p.keyboard.down('Control'); await p.mouse.wheel(0, -100); await p.keyboard.up('Control'); await p.waitForTimeout(150);
const z1 = await p.textContent('#zoom-val');
const anchor2 = await p.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, anchor.id);
ok('ctrl+wheel zooms around the cursor', parseInt(z1) > parseInt(z0) && Math.abs(anchor2.x - anchor.x) < 3 && Math.abs(anchor2.y - anchor.y) < 3, [z0, z1, anchor, anchor2, await p.evaluate(() => window.LASTW)]);
ok('panning leaves the source alone', !/nudge/.test((await src()).split('%% @layout')[1] || ''));
// a node drag still lands where the pointer goes after panning and zooming
const nb = await p.evaluate(() => { const n = document.querySelector('#sheet [id*="-flowchart-fs-"]'); const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await drag(nb, { x: nb.x + 50, y: nb.y + 30 });
const nb2 = await p.evaluate(() => { const n = document.querySelector('#sheet [id*="-flowchart-fs-"]'); const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
ok('node follows the pointer on a panned, zoomed canvas', Math.abs(nb2.x - nb.x - 50) < 8 && Math.abs(nb2.y - nb.y - 30) < 8, [nb, nb2]);
// 12. switch examples
for (const v of ['1', '2', '3', '4']) {
  await p.selectOption('#example', v); await p.waitForTimeout(900);
  const info = await p.evaluate(() => ({ svgs: document.querySelectorAll('#sheet svg').length, notice: document.getElementById('notice').hidden }));
  ok(`example ${v} renders`, info.svgs === 1, info);
  await p.screenshot({ path: SHOT + `ex${v}.png` });
}
console.log(R.join('\n'));
await b.close();
