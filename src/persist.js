/*
 * Keeping a diagram's adjustments in the browser, for <wermaid-diagram>.
 *
 * An entry is the diagram's layout block (which includes the user's theme and edge-look picks),
 * stored under `wermaid:layout:<key>` as { block, used }. The key is the element's `persist-key`,
 * else a hash of the source as the app supplied it (see sourceKey). An index under
 * `wermaid:layout:index` lists the keys, least recently used first, and keeps the newest 200.
 *
 * Storage can be missing, full or blocked. Every call is guarded, and the first failure turns
 * the persistence it came from off for good: the diagram carries on, just without keeping anything.
 */
import { parseSource } from './wermaid.js';

const PREFIX = 'wermaid:layout:';
const INDEX = PREFIX + 'index';
export const MAX_LAYOUTS = 200;

/** A short deterministic string for a supplied source: indentation, line endings and outer whitespace do not count. */
export function sourceKey(text) {
  const s = String(text).replace(/\r\n?/g, '\n').trim();
  // cyrb53: two 32-bit hashes mixed into 53 bits.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The text with its layout block replaced by `block` ('' = no block). */
export function withBlock(text, block) {
  const { body } = parseSource(text);
  return block ? `${body}\n\n${block}\n` : `${body}\n`;
}

// A key that would collide with the index is moved aside (one more underscore), so the
// mapping stays one to one.
const slot = (key) => PREFIX + (/^_*index$/.test(key) ? '_' + key : key);

/** One element's access to the stored layouts. */
export function createPersistence() {
  let failed = false;
  const guard = (fn, fallback) => {
    if (failed) return fallback;
    try { return fn(); } catch { failed = true; return fallback; }
  };
  const readIndex = (ls) => {
    try {
      const list = JSON.parse(ls.getItem(INDEX) ?? '[]');
      return Array.isArray(list) ? list.filter((k) => typeof k === 'string') : [];
    } catch (err) {
      if (err instanceof SyntaxError) return [];
      throw err;
    }
  };
  // Mark a key as the most recently used, and drop the least recently used past the limit.
  const touch = (ls, key) => {
    const keys = readIndex(ls).filter((k) => k !== key);
    keys.push(key);
    while (keys.length > MAX_LAYOUTS) ls.removeItem(slot(keys.shift()));
    ls.setItem(INDEX, JSON.stringify(keys));
  };
  const write = (ls, key, block) => {
    ls.setItem(slot(key), JSON.stringify({ block, used: Date.now() }));
    touch(ls, key);
  };
  return {
    /** True once a storage call has failed; nothing is kept after that. */
    get failed() { return failed; },
    /** The stored block for a key (and mark it used), or null. */
    load: (key) => guard(() => {
      const ls = localStorage;
      const raw = ls.getItem(slot(key));
      if (raw === null) return null;
      let entry;
      try { entry = JSON.parse(raw); } catch { return null; }
      if (typeof entry?.block !== 'string') return null;
      write(ls, key, entry.block);
      return entry.block;
    }, null),
    /** Keep a block for a key. */
    save: (key, block) => guard(() => write(localStorage, key, block)),
    /** Forget a key. */
    drop: (key) => guard(() => {
      const ls = localStorage;
      ls.removeItem(slot(key));
      const keys = readIndex(ls);
      if (keys.includes(key)) ls.setItem(INDEX, JSON.stringify(keys.filter((k) => k !== key)));
    }),
  };
}
