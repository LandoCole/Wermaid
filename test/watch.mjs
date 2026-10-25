import { chromium } from 'playwright';
const BASE = `http://127.0.0.1:${process.env.WERMAID_TEST_PORT || 8765}`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(BASE + '/test/watch.html');
await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('wermaid:layout:')) localStorage.removeItem(k); });
await p.reload();
await p.waitForFunction(() => window.READY, null, { timeout: 30000 });
const R = []; const ok = (n, c, x) => R.push(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + JSON.stringify(x)}`);

// A diagram arriving a few characters at a time; every partial version but the last is unfinished.
const split = (text, size = 8) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'));
const mermaidSource = 'flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| D[Retry]\n  D --> A';
const mermaidChunks = split(mermaidSource);
const invalidChunks = split('flowchart LR\n  A --> B\n  B --> {{{ oops');

const events = (type, where) => p.evaluate(([type, where]) => EVENTS.filter((e) => e.type === type && e.where === where).length, [type, where]);
const renderCount = () => events('render', 'chat');
const renderCount2 = () => events('render', 'chat2');
const errorEvents = () => events('error', 'chat3');
const errorEventsFor = (sel) => events('error', sel.slice(1));
const mermaidCalls = () => p.evaluate(() => MERMAID_CALLS);
// Wait for the message's next render or error after `since` events, then long enough to see a second one.
const settled = async (where, since) => {
  await p.waitForFunction(([where, since]) => EVENTS.filter((e) => e.where === where).length > since, [where, since], { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(700);
};
const seen = (where) => p.evaluate((where) => EVENTS.filter((e) => e.where === where).length, where);
// Stream into one <pre>, adding to its text node.
const appendChunks = async (sel, chunks, ms) => {
  const since = await seen(sel.slice(1));
  for (const [i, chunk] of chunks.entries()) {
    await p.$eval(sel, (m, [chunk, first]) => {
      if (first) m.innerHTML = '<p>Here it is:</p><pre class="mermaid"></pre>';
      const pre = m.querySelector('pre');
      if (!pre.firstChild) pre.append('');
      pre.firstChild.appendData(chunk);
    }, [chunk, i === 0]);
    await p.waitForTimeout(ms);
  }
  await settled(sel.slice(1), since);
};
// The whole message rebuilt from Markdown-ish HTML on every chunk, recreating the <pre>.
const html = (text, n) => `<p>Here it is:</p><pre data-features="edit"><code class="language-mermaid">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre><p>${n} chunks so far</p>`;
const rebuildChunks = async (sel, chunks, ms) => {
  const since = await seen(sel.slice(1));
  let text = '';
  for (const [i, chunk] of chunks.entries()) {
    text += chunk;
    await p.$eval(sel, (m, h) => { m.innerHTML = h; }, html(text, i + 1));
    await p.waitForTimeout(ms);
  }
  await settled(sel.slice(1), since);
};
const rebuildSame = async (sel) => {
  const since = await seen(sel.slice(1));
  await p.$eval(sel, (m, h) => { m.innerHTML = h; }, html(mermaidSource, mermaidChunks.length));
  await settled(sel.slice(1), since);
};
const errorShown = (sel) => p.evaluate((sel) => { const e = document.querySelector(`${sel} wermaid-diagram`); return !!e && !e.shadowRoot.querySelector('.error').hidden; }, sel);
// The element rendered within `ms` of being asked to (see STARTS in the page).
const renderedWithin = async (sel, ms) => {
  const where = sel.slice(1);
  await p.waitForFunction((where) => EVENTS.some((e) => e.where === where && e.type === 'render'), where, { timeout: 3000 }).catch(() => {});
  const took = await p.evaluate((where) => (EVENTS.find((e) => e.where === where && e.type === 'render')?.t ?? Infinity) - STARTS[where], where);
  if (!(took < ms)) console.log(`  ${sel} took ${took} ms`);
  return took < ms;
};

ok('run({ watch }) still resolves with settled results, and can stop', await p.evaluate(() =>
  Array.isArray(SETTLED) && SETTLED.length === 1 && SETTLED[0].status === 'fulfilled' && typeof RUN.stop === 'function'), await p.evaluate(() => SETTLED));
ok('static blocks render without waiting', await renderedWithin('#static', 100));

await appendChunks('#chat', mermaidChunks, 50);
ok('streamed block renders once after settling', await renderCount() === 1 && await events('error', 'chat') === 0, [await renderCount(), await events('error', 'chat')]);
ok('the streamed block becomes the element', await p.$eval('#chat', (m) => !m.querySelector('pre') && m.querySelector('wermaid-diagram')?.diagram?.scene?.nodes.size === 4));

await rebuildChunks('#chat2', mermaidChunks, 50);
ok('innerHTML-rebuilt message renders once', await renderCount2() === 1 && await events('error', 'chat2') === 0, [await renderCount2(), await events('error', 'chat2')]);

// Adjust the diagram, so the rebuilt one has a stored layout to put back.
const centre = await p.evaluate(() => {
  const e = document.querySelector('#chat2 wermaid-diagram');
  const node = e?.diagram?.scene?.nodes.get('C');
  if (!node) return null;
  e.scrollIntoView({ block: 'center' });
  const r = node.el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (centre) {
  await p.mouse.move(centre.x, centre.y); await p.mouse.down();
  await p.mouse.move(centre.x, centre.y + 48, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(150);
}
const callsBefore = await mermaidCalls();
const before = await renderCount2();
await rebuildSame('#chat2');
ok('unchanged block reuses the cached drawing', await mermaidCalls() === callsBefore && await renderCount2() === before + 1, [await mermaidCalls(), callsBefore]);
ok('the reused drawing is a working, editable diagram with its adjustment put back', await p.$eval('#chat2', (m, e = m.querySelector('wermaid-diagram')) =>
  !!e?.diagram?.supported && e.diagram.scene.nodes.size === 4 && e.diagram.svg.isConnected
  && e.shadowRoot.querySelector('.stage').classList.contains('editable')
  && /%% C\s+nudge 0,\d+/.test(e.editedSource) && !!e._editor), await p.$eval('#chat2', (m) => m.querySelector('wermaid-diagram')?.editedSource));
ok('the reused drawing still draws the adjustment', await p.$eval('#chat2', (m) => m.querySelector('wermaid-diagram')?.diagram?.geometry?.changed === true));

await appendChunks('#chat3', invalidChunks, 50);
ok('invalid final source shows one error after settling', await errorEvents() === 1 && await errorShown('#chat3'), await errorEvents());

ok('a streaming element draws nothing and shows no error', await p.$eval('#s', (e) =>
  !e.shadowRoot.querySelector('svg') && e.shadowRoot.querySelector('.error').hidden) && await errorEventsFor('#s') === 0);
await p.$eval('#s', (e) => { e.textContent = 'flowchart LR\n  P --> Q'; });
await p.waitForTimeout(500);
ok('text arriving while streaming still draws nothing', await p.$eval('#s', (e) => !e.shadowRoot.querySelector('svg')) && await errorEventsFor('#s') === 0);
await p.$eval('#s', (e) => e.removeAttribute('streaming'));
ok('removing streaming renders at once', await renderedWithin('#s', 100) && await errorEventsFor('#s') === 0, await errorEventsFor('#s'));
ok('the element\'s rendered promise resolves once streaming ends', await p.$eval('#s', (e) => e.rendered.then((d) => !!d?.svg, () => false)));

// After stop(), new blocks are left alone.
await p.evaluate(() => RUN.stop?.());
await p.$eval('#later', (m) => { m.innerHTML = '<pre class="mermaid">flowchart LR\n  L1 --> L2</pre>'; });
await p.waitForTimeout(700);
ok('stop() ends watching', await p.$eval('#later', (m) => !!m.querySelector('pre') && !m.querySelector('wermaid-diagram')));

console.log(R.join('\n'));
await b.close();
