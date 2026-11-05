// Run: npm test --prefix scripts   (node --test)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { buildKb } from "./build-kb.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kb = buildKb(ROOT);
const cv = YAML.parse(readFileSync(join(ROOT, "_data/cv.yml"), "utf8"));
const projects = readdirSync(join(ROOT, "_projects")).filter((f) => f.endsWith(".md")).map((f) => {
  const raw = readFileSync(join(ROOT, "_projects", f), "utf8");
  return { file: f, fm: YAML.parse(raw.match(/^---\n([\s\S]*?)\n---/)[1]) };
});

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

test("the CV in _data/cv.yml is indexed as core facts and the About page renders an anchor for each", () => {
  const about = readFileSync(join(ROOT, "_pages/about-me.html"), "utf8");
  for (const marker of ['id="exp-{{ x.id }}"', 'id="edu-{{ x.id }}"', 'id="oss-{{ x.id }}"', 'id="honors"', 'id="skills"']) {
    assert.ok(about.includes(marker), `about page lacks ${marker}`);
  }
  const want = [
    ...cv.experience.map((x) => `exp-${x.id}`), ...cv.education.map((x) => `edu-${x.id}`),
    ...cv.honors.map((x) => `honor-${x.id}`), ...cv.opensource.map((x) => `oss-${x.id}`), "skills", "about",
  ];
  for (const id of want) assert.ok(kb.chunks.find((c) => c.id === id)?.core, `${id} missing or not core`);
  assert.match(kb.chunks.find((c) => c.id === "exp-qualcomm").text, /Qualcomm.*Apr 2026.*Present/);
});

test("the public websites are known to the chatbot (kilomet.com.vn, goodjobs.io.vn)", () => {
  const w = kb.chunks.find((c) => c.id === "websites");
  assert.ok(w?.core);
  assert.match(w.text, /kilomet\.com\.vn/);
  assert.match(w.text, /goodjobs\.io\.vn/);
});

test("honours carry their real years (Zalo 2022, FPT AI Center 2021)", () => {
  const t = kb.chunks.filter((c) => c.type === "honor").map((c) => c.text).join(" | ");
  assert.match(t, /Zalo AI Challenge 2022/);
  assert.match(t, /FPT AI Center 2021/);
});

test("every project has the facts the cards, the schema and the chatbot need; images exist; SEO lengths hold", () => {
  assert.ok(projects.length >= 7);
  for (const { file, fm } of projects) {
    for (const k of ["title", "card_title", "tagline", "summary", "role", "stack", "cover", "cover_alt", "description", "image", "date"]) {
      assert.ok(fm[k], `${file}: missing ${k}`);
    }
    assert.ok(String(fm.title).length <= 60, `${file}: title is ${String(fm.title).length} chars (max 60)`);
    assert.ok(fm.description.length >= 120 && fm.description.length <= 160, `${file}: description is ${fm.description.length} chars (120-160)`);
    for (const k of ["cover", "image"]) assert.ok(existsSync(join(ROOT, fm[k])), `${file}: ${k} file ${fm[k]} does not exist`);
    assert.ok(kb.chunks.some((c) => c.type === "project" && c.core && c.text.includes(fm.card_title)), `${file}: no core chunk`);
  }
});

test("project pages are chunked by heading and link to the heading anchor", () => {
  const pages = kb.chunks.filter((c) => c.id.startsWith("project-goodjobs-"));
  assert.ok(pages.length >= 3);
  assert.ok(pages.some((c) => c.url === "/goodjobs/#highlights"));
  assert.ok(pages.every((c) => !c.core && c.dedupe === "/goodjobs/"));
  assert.ok(!kb.chunks.some((c) => /```/.test(c.text)), "fenced code must be stripped");
});

test("goodjobs says 21 sources everywhere (the README and the product card say 21)", () => {
  const all = kb.chunks.filter((c) => /goodjobs/i.test(c.id + c.title)).map((c) => c.text).join(" ");
  assert.doesNotMatch(all, /\b18 (job boards|sources)\b/);
  assert.match(all, /21 sources/);
});

test("credential-looking lines never enter the index", () => {
  assert.doesNotMatch(JSON.stringify(kb), /password|passwd|api[_ -]?key|bearer/i);
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
