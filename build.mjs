import fs from 'node:fs';
import { EXAMPLES } from './src/examples.mjs';
const strip = (src) => src
  .replace(/^import .*$/gm, '')
  .replace(/^export \{[^}]*\};?$/gm, '')
  .replace(/^export default .*$/m, '')
  .replace(/^export (const|function|class|async function) /gm, '$1 ');
const lib = strip(fs.readFileSync('src/themes.js', 'utf8')) + '\n' + strip(fs.readFileSync('src/wermaid.js', 'utf8'));
// The editor also inlines the editing module (the embed demo doesn't edit).
const editorLib = lib + '\n' + strip(fs.readFileSync('src/edit.js', 'utf8'));
let html = fs.readFileSync('src/editor.html', 'utf8');
html = html.replace('/*__WERMAID_LIBRARY__*/', () => editorLib).replace('/*__WERMAID_EXAMPLES__*/', () => JSON.stringify(EXAMPLES, null, 2));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/editor.html', html);
// Local test page: same file wrapped in a document (the artifact host adds this skeleton itself).
fs.writeFileSync('dist/local.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${html}</body></html>`);
console.log('built editor', (html.length / 1024).toFixed(1) + ' KB');

// Embed demo: library + <wermaid-diagram> element inlined.
const embedLib = lib + '\n' + strip(fs.readFileSync('src/element.js', 'utf8'));
const demo = fs.readFileSync('src/embed-demo.html', 'utf8').replace('/*__WERMAID_LIBRARY__*/', () => embedLib);
fs.writeFileSync('dist/embed-demo.html', demo);
fs.writeFileSync('dist/embed-local.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${demo}</body></html>`);
console.log('built embed demo', (demo.length / 1024).toFixed(1) + ' KB');
