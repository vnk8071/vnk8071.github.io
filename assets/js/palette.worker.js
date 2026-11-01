/* In-browser semantic search worker for the ⌘K palette (module worker).
 *
 * Runs a small sentence-embedding model (transformers.js + ONNX/WASM) off the main thread:
 *   init  -> download the model (browser-cached), embed every knowledge-base chunk once (vectors cached in
 *            IndexedDB, keyed by model + kb hash), then reply "ready"
 *   query -> embed the query, cosine-rank all chunks, reply with the top hits
 *
 * Protocol (main -> worker):  {type:'init', transformersUrl, model, dtype, queryPrefix, passagePrefix, kbHash, docs:[string]}
 *                             {type:'query', qid, text, k}
 * Protocol (worker -> main):  {type:'progress', phase:'download'|'index', pct}
 *                             {type:'ready', dim, cached}   {type:'result', qid, hits:[[docIndex, score]]}
 *                             {type:'error', message}
 */

let extractor = null;
let matrix = null; // Float32Array, N x dim, rows L2-normalised
let dim = 0;
let cfg = null;

const post = (msg) => self.postMessage(msg);

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") init(m).catch((err) => post({ type: "error", message: String((err && err.message) || err) }));
  else if (m.type === "query") query(m).catch((err) => post({ type: "error", message: String((err && err.message) || err) }));
};

// ---- IndexedDB (one record; replaced when the model or knowledge base changes) ----------------

const DB = "cmdk-embeddings";
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("kv").objectStore("kv").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- model -------------------------------------------------------------------------------------

async function init(m) {
  cfg = m;
  const { pipeline, env } = await import(m.transformersUrl);
  env.allowLocalModels = false; // always fetch from the Hugging Face hub
  env.useBrowserCache = true; // Cache Storage: the model is downloaded once per browser

  const files = new Map();
  extractor = await pipeline("feature-extraction", m.model, {
    dtype: m.dtype,
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files.set(p.file, [p.loaded, p.total]);
        let loaded = 0;
        let total = 0;
        files.forEach(([l, t]) => { loaded += l; total += t; });
        post({ type: "progress", phase: "download", pct: Math.min(99, Math.round((100 * loaded) / total)) });
      }
    },
  });

  const key = [m.model, m.dtype, m.kbHash, m.passagePrefix].join("|");
  let cached = null;
  try { cached = await idbGet("current"); } catch { /* private mode etc.: just recompute */ }
  if (cached && cached.key === key && cached.n === m.docs.length) {
    matrix = new Float32Array(cached.buf);
    dim = cached.dim;
    post({ type: "ready", dim, cached: true });
    return;
  }

  const rows = [];
  const BATCH = 8;
  for (let i = 0; i < m.docs.length; i += BATCH) {
    const texts = m.docs.slice(i, i + BATCH).map((d) => m.passagePrefix + d);
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    dim = out.dims[1];
    rows.push(Float32Array.from(out.data));
    post({ type: "progress", phase: "index", pct: Math.round((100 * Math.min(i + BATCH, m.docs.length)) / m.docs.length) });
  }
  matrix = new Float32Array(m.docs.length * dim);
  let off = 0;
  for (const r of rows) { matrix.set(r, off); off += r.length; }
  try { await idbPut("current", { key, n: m.docs.length, dim, buf: matrix.buffer.slice(0) }); } catch { /* non-fatal */ }
  post({ type: "ready", dim, cached: false });
}

async function query(m) {
  if (!extractor || !matrix) return;
  const out = await extractor([cfg.queryPrefix + m.text], { pooling: "mean", normalize: true });
  const q = out.data;
  const n = matrix.length / dim;
  const scored = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * dim;
    for (let d = 0; d < dim; d++) s += matrix[base + d] * q[d];
    scored[i] = [i, s];
  }
  scored.sort((a, b) => b[1] - a[1]);
  post({ type: "result", qid: m.qid, hits: scored.slice(0, m.k || 12) });
}
