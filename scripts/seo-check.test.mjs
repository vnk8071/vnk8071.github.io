import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditSite } from "./seo-check.mjs";

const BASE = "https://example.test";

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), "seo-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const goodPage = (extra = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Good page title</title>
<meta name="description" content="${"A sensible description of the page that is long enough to be useful in search results and social cards. ".repeat(1).slice(0, 130)}">
<link rel="canonical" href="${BASE}/">
<meta property="og:title" content="Good"><meta property="og:description" content="d"><meta property="og:image" content="${BASE}/og.png">
</head><body><h1>Hello</h1>${extra}</body></html>`;

test("flags an image without alt as an error", () => {
  const dir = site({ "index.html": goodPage('<img src="/a.png" width="1" height="1">') });
  const r = auditSite(dir, BASE);
  assert.ok(r.errors.some((e) => /alt/.test(e)), JSON.stringify(r));
});

test("flags a missing canonical and a missing h1", () => {
  const dir = site({ "index.html": "<!doctype html><html lang='en'><head><title>t</title></head><body><p>x</p></body></html>" });
  const r = auditSite(dir, BASE);
  assert.ok(r.errors.some((e) => /canonical/i.test(e)), JSON.stringify(r));
  assert.ok(r.errors.some((e) => /h1/i.test(e)), JSON.stringify(r));
});
