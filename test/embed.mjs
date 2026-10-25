import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto('http://127.0.0.1:8765/test/embed.html');
await p.waitForFunction(() => window.READY, null, { timeout: 30000 });
await p.waitForTimeout(500);
const R = []; const ok = (n, c, x) => R.push(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(x)}`);
const el = (id) => `#${id}`;
const geom = (id, node) => p.$eval(el(id), (e, node) => { const g = e.diagram?.geometry?.nodes.get(node); return g && { dy: g.delta.y, dx: g.delta.x }; }, node);

// 1. inline source with a layout block
ok('inline element renders with overrides', (await geom('inline', 'B'))?.dy === 60, await geom('inline', 'B'));
ok('inline source text is not shown', await p.$eval(el('inline'), (e) => e.shadowRoot.querySelector('svg') && e.getBoundingClientRect().height > 50 && !e.shadowRoot.textContent.includes('%% @layout')));
ok('inline svg is responsive', await p.$eval(el('inline'), (e) => e.diagram.svg.getAttribute('width') === '100%'));
// 2. palette
const fill = (id) => p.$eval(el(id), (e) => getComputedStyle(e.diagram.svg.querySelector('g.node .label-container')).fill);
ok('theme="pele" uses the Pele palette', (await fill('pele')) === 'rgb(242, 240, 229)', await fill('pele'));
ok('default palette is Wermaid', (await fill('inline')) === 'rgb(249, 249, 247)', await fill('inline'));
// 3. canvas viewer
const t = () => p.$eval(el('canvas'), (e) => { const m = new DOMMatrix(getComputedStyle(e.shadowRoot.querySelector('.stage')).transform); return [m.e, m.f, e.shadowRoot.querySelector('output').textContent]; });
const box = await (await p.$(el('canvas'))).boundingBox();
ok('pannable viewer has the requested height', Math.abs(box.height - 360) < 1, box.height);
ok('toolbar shows zoom and export', await p.$eval(el('canvas'), (e) => !e.shadowRoot.querySelector('.toolbar').hidden && !e.shadowRoot.querySelector('.zoomers').hidden));
const t0 = await t();
await p.mouse.move(box.x + 60, box.y + box.height - 30); await p.mouse.down(); await p.mouse.move(box.x + 160, box.y + box.height - 90, { steps: 8 }); await p.mouse.up();
const t1 = await t();
ok('drag pans the canvas', Math.abs(t1[0] - t0[0] - 100) < 2 && Math.abs(t1[1] - t0[1] + 60) < 2, [t0, t1]);
const zoomBtn = await p.evaluateHandle(() => document.querySelector('#canvas').shadowRoot.querySelector('[data-act="in"]'));
await zoomBtn.click(); await p.waitForTimeout(50);
const t2 = await t();
ok('zoom in button zooms', parseInt(t2[2]) > parseInt(t1[2]), [t1[2], t2[2]]);
await p.mouse.move(box.x + 300, box.y + 200);
await p.keyboard.down('Control'); await p.mouse.wheel(0, 200); await p.keyboard.up('Control'); await p.waitForTimeout(50);
const t3 = await t();
ok('ctrl+wheel zooms out', parseInt(t3[2]) < parseInt(t2[2]), [t2[2], t3[2]]);
const sy = await p.evaluate(() => window.scrollY);
await p.mouse.wheel(0, 120); await p.waitForTimeout(150);
ok('plain wheel still scrolls the page', (await p.evaluate(() => window.scrollY)) > sy);
await (await p.evaluateHandle(() => document.querySelector('#canvas').shadowRoot.querySelector('[data-act="fit"]'))).click();
ok('Fit restores the fitted view', JSON.stringify(await t()) === JSON.stringify(t0), [t0, await t()]);
// export from the toolbar
await (await p.evaluateHandle(() => document.querySelector('#canvas').shadowRoot.querySelector('[data-act="menu"]'))).click();
const [dl] = await Promise.all([p.waitForEvent('download'), (await p.evaluateHandle(() => document.querySelector('#canvas').shadowRoot.querySelector('[data-act="save-png"]'))).click()]);
const buf = fs.readFileSync(await dl.path());
ok('toolbar saves a PNG', dl.suggestedFilename() === 'canvas-demo.png' && buf.slice(1, 4).toString() === 'PNG', dl.suggestedFilename());
// 4. src
ok('src= loads a .mmd file', (await geom('remote', 'pay'))?.dy === 40, await geom('remote', 'pay'));
// 5. run()
const runInfo = await p.evaluate(() => ({ left: document.querySelectorAll('pre.mermaid, code.language-mermaid').length, made: [...document.querySelectorAll('#s5 wermaid-diagram')].map((e) => ({ theme: e.getAttribute('theme'), ok: !!e.diagram })), settled: RUN.map((r) => r.status) }));
ok('run() replaces Mermaid blocks', runInfo.left === 0 && runInfo.made.length === 2 && runInfo.made.every((m) => m.ok), runInfo);
ok('run() passes data-theme through', runInfo.made[1].theme === 'mermaid', runInfo.made);
ok('run() resolves once rendered', runInfo.settled.length === 3 && runInfo.settled.every((s) => s === 'fulfilled'), runInfo.settled);
ok('run() decodes HTML entities in the block', await p.evaluate(() => document.querySelector('#s5 wermaid-diagram').diagram.scene.edges.size === 1));
const nested = await p.evaluate(() => { const e = document.querySelectorAll('#s5 wermaid-diagram')[1]; return e.diagram.geometry.nodes.get('N').delta.y; });
ok('run() applies layout blocks', nested === 30, nested);
// 6. live updates
await p.$eval(el('pele'), (e) => { e.textContent = 'flowchart LR\n  X --> Y --> Z'; });
await p.waitForTimeout(600);
ok('editing the text re-renders', await p.$eval(el('pele'), (e) => e.diagram.scene.nodes.size === 3));
await p.$eval(el('pele'), (e) => { e.setAttribute('theme', 'mermaid'); });
await p.waitForTimeout(600);
ok('changing theme re-renders', (await fill('pele')) === 'rgb(238, 238, 238)', await fill('pele'));
await p.$eval(el('pele'), (e) => { e.source = 'flowchart TD\n  S --> T'; return e.rendered; });
ok('source property renders', await p.$eval(el('pele'), async (e) => { await e.rendered; return e.diagram.scene.nodes.has('S'); }));
// 7. hidden until shown
ok('hidden element waits', await p.$eval(el('hidden'), (e) => !e.diagram));
await p.$eval('#tab', (d) => { d.style.display = 'block'; }); await p.waitForTimeout(700);
ok('renders once it is shown, with real sizes', await p.$eval(el('hidden'), (e) => !!e.diagram && e.diagram.scene.nodes.size === 2 && e.diagram.scene.nodes.get('H1').box.w > 10));
// 8. errors
ok('bad source shows an error and fires wermaid:error', await p.$eval(el('broken'), (e) => !e.shadowRoot.querySelector('.error').hidden) && (await p.evaluate(() => EVENTS.some(([k, id]) => k === 'error' && id === 'broken'))));
ok('wermaid:render fires', await p.evaluate(() => EVENTS.filter(([k]) => k === 'render').length >= 6));
// 10. <br/> and entities in inline source survive HTML parsing
const br = await p.evaluate(async () => {
  const e = document.querySelector('#br'); await e.rendered;
  const lines = (id, root) => [...root.diagram.svg.querySelectorAll('.node')].find((n) => n.id.includes(id))?.querySelectorAll('p br, tspan.row, text tspan').length ?? -1;
  const pre = document.querySelector('#s9 wermaid-diagram:not(#br)'); await pre?.rendered;
  return { src: e.source, a: lines('-A-', e), p: pre ? lines('-P-', pre) : -2, label: e.diagram.svg.textContent.includes('a & b') };
});
ok('inline source keeps <br/> and decodes entities', br.src.includes('Lambda<br/>query') && br.src.includes('a & b') && br.src.includes('Two<br/>lines'), br.src);
ok('<br/> renders as a line break', br.a >= 1 && br.label, br);
ok('run() keeps <br/> from pre.mermaid', br.p >= 1, br);

// 9. dark
ok('dark="true" uses the dark palette', (await fill('dark')) === 'rgb(21, 21, 22)', await fill('dark'));
console.log(R.join('\n'));
await b.close();
