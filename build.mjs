import fs from 'node:fs';
import { EXAMPLES } from './src/examples.mjs';
const lib = fs.readFileSync('src/wermaid.js', 'utf8')
  .replace(/^export default .*$/m, '')
  .replace(/^export (const|function|class|async function) /gm, '$1 ');
let html = fs.readFileSync('src/editor.html', 'utf8');
html = html.replace('/*__WERMAID_LIBRARY__*/', () => lib).replace('/*__WERMAID_EXAMPLES__*/', () => JSON.stringify(EXAMPLES, null, 2));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/editor.html', html);
// Local test page: same file wrapped in a document (the artifact host adds this skeleton itself).
fs.writeFileSync('dist/local.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${html}</body></html>`);
console.log('built', (html.length / 1024).toFixed(1) + ' KB');
