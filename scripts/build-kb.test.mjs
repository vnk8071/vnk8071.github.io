// Run: npm test --prefix scripts   (node --test)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKb } from "./build-kb.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kb = buildKb(ROOT);

test("every chunk is well-formed and ids are unique", () => {
  const ids = new Set();
  for (const c of kb.chunks) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`);
    ids.add(c.id);
    assert.ok(c.title && c.text.length >= 20, `${c.id}: title/text too short`);
    assert.ok(c.url.startsWith("/"), `${c.id}: url must be site-relative (${c.url})`);
    assert.ok(c.label && c.dedupe, `${c.id}: label/dedupe missing`);
    assert.ok(c.text.length <= 900 || c.core, `${c.id}: chunk too long (${c.text.length})`);
    assert.doesNotMatch(c.text, /<[a-z][^>]*>|!\[|\]\(/i, `${c.id}: leftover HTML/markdown`);
  }
});

test("the whole CV on the home page is indexed as core facts, with working anchors", () => {
  const home = readFileSync(resolve(ROOT, "_layouts/home.html"), "utf8");
  const anchored = [...home.matchAll(/id="([^"]+)" data-kb=/g)].map((m) => m[1]);
  assert.ok(anchored.length >= 18);
  for (const id of anchored) {
    const c = kb.chunks.find((x) => x.id === id);
    assert.ok(c?.core, `#${id} missing from the kb or not core`);
    assert.equal(c.url, "/#" + id);
  }
  assert.match(kb.chunks.find((c) => c.id === "exp-qualcomm").text, /Qualcomm.*Apr 2026.*Present/);
  assert.doesNotMatch(kb.chunks.find((c) => c.id === "exp-qualcomm").text, /Qualcommnow/);
});

test("project pages are chunked by heading and link to the heading anchor", () => {
  const pages = kb.chunks.filter((c) => c.id.startsWith("project-goodjobs-"));
  assert.ok(pages.length >= 3);
  assert.ok(pages.some((c) => c.url === "/goodjobs/#highlights"));
  assert.ok(pages.every((c) => !c.core && c.dedupe === "/goodjobs/"));
  assert.ok(!kb.chunks.some((c) => /```/.test(c.text)), "fenced code must be stripped");
});

test("credential-looking lines never enter the index", () => {
  const all = JSON.stringify(kb);
  assert.doesNotMatch(all, /password|passwd|api[_ -]?key|bearer/i);
  assert.ok(kb.chunks.some((c) => c.id.startsWith("project-anomaly-detection-")), "the page itself is still indexed");
});

test("core context stays small enough to always send to the LLM", () => {
  const core = kb.chunks.filter((c) => c.core).reduce((n, c) => n + c.text.length, 0);
  assert.ok(core < 8000, `core context is ${core} chars`);
});

test("suggested questions from _config.yml are published for the guardrail", () => {
  assert.equal(kb.suggestions.length, 3);
});

test("build is deterministic and the committed assets/data/kb.json is up to date", () => {
  assert.equal(buildKb(ROOT).hash, kb.hash);
  execFileSync("node", [resolve(ROOT, "scripts/build-kb.mjs"), "--check"], { stdio: "pipe" });
});
