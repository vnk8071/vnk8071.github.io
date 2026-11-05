// Run: npm test --prefix scripts   (node --test)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { buildKb } from "./build-kb.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "public");
const kb = buildKb(ROOT);

const htmlFiles = (dir = SITE) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "assets" ? [] : htmlFiles(p);
    return entry.name.endsWith(".html") ? [p] : [];
  });

const projectPages = htmlFiles()
  .map((file) => ({ file, root: parse(readFileSync(file, "utf8")) }))
  .filter(({ root }) => root.querySelector(".project-prose"))
  .map(({ file, root }) => ({
    file,
    root,
    url: "/" + relative(SITE, file).split(sep).join("/").replace(/index\.html$/, ""),
  }));

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

test("the rendered About page exposes an anchor for every CV fact, and each is a core chunk", () => {
  const about = readFileSync(join(SITE, "about/index.html"), "utf8");
  for (const id of ["exp-qualcomm", "exp-viact", "edu-msc-ai-vnuhcm", "oss-qualcomm-qai-appbuilder", "honors", "skills"]) {
    assert.ok(about.includes(`id="${id}"`), `about page lacks #${id}`);
  }
  for (const id of ["about", "exp-qualcomm", "edu-msc-ai-vnuhcm", "oss-qualcomm-qai-appbuilder", "skills"]) {
    assert.ok(kb.chunks.find((c) => c.id === id)?.core, `${id} missing or not core`);
  }
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

test("every project page has the metadata, cover and core chunk the cards and chatbot need", () => {
  assert.ok(projectPages.length >= 8);
  for (const { file, root, url } of projectPages) {
    const rel = relative(ROOT, file);
    const title = root.querySelector("title")?.text.trim() ?? "";
    const desc = root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    const cover = root.querySelector(".project-image-wrap img, .projec-image-main")?.getAttribute("src") ?? "";
    assert.ok(title, `${rel}: missing title`);
    assert.ok(desc.length >= 100 && desc.length <= 160, `${rel}: description is ${desc.length} chars (aim 120-160)`);
    assert.ok(cover && existsSync(join(SITE, cover)), `${rel}: cover image ${cover} does not exist`);
    assert.ok(
      kb.chunks.some((c) => c.type === "project" && c.core && c.url === url),
      `${rel}: no core project chunk for ${url}`,
    );
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

test("suggested questions from the page config are published for the guardrail", () => {
  assert.equal(kb.suggestions.length, 3);
});

test("every page keeps the Webflow runtime wiring that drives the interactions", () => {
  for (const file of htmlFiles()) {
    const html = readFileSync(file, "utf8");
    const rel = relative(SITE, file);
    if (/http-equiv="refresh"/i.test(html)) continue; // /project/ redirect page
    assert.ok(/data-wf-page="[a-f0-9]+"/.test(html), `${rel}: missing data-wf-page`);
    assert.ok(/data-wf-site="[a-f0-9]+"/.test(html), `${rel}: missing data-wf-site`);
    assert.match(html, /jquery-3\.5\.1/, `${rel}: missing jQuery`);
    assert.match(html, /webflow\.schunk\./, `${rel}: missing Webflow runtime chunks`);
    assert.match(html, /webflow\.[a-f0-9]+\./, `${rel}: missing page-specific Webflow bundle`);
    assert.doesNotMatch(html, /\{\{[^}]*\}\}|\{%[^%]*%\}/, `${rel}: Liquid syntax leaked into the build`);
  }
});

test("build is deterministic and the committed public/assets/data/kb.json is up to date", () => {
  assert.equal(buildKb(ROOT).hash, kb.hash);
  execFileSync("node", [resolve(ROOT, "scripts/build-kb.mjs"), "--check"], { stdio: "pipe" });
});
