#!/usr/bin/env node
// Builds assets/data/kb.json - the static knowledge base behind the ⌘K command palette.
//
// One file feeds three consumers:
//   1. the in-browser semantic / keyword search (assets/js/palette.worker.js)
//   2. the "Ask my profile" micro-RAG (the Cloudflare Worker in workers/ask fetches this same file)
//   3. palette navigation (nav links + social links)
//
// Sources, in order:
//   - _data/cv.yml         the CV: summary, experience, education, honours, open source, skills (also renders /about/)
//   - _projects/*.md       front matter (card facts) -> one always-in-context chunk per project, plus the page body
//   - _config.yml          name / bio / location / contact links
//   - _projects, _posts, _publications   markdown, split by heading into <= MAX_CHUNK char chunks
//   - _data/profile.yml    extra facts (`facts:`) and search aliases (`keywords:`)
//
// Usage: node scripts/build-kb.mjs [--out assets/data/kb.json] [--check]
//   --check  exit 1 if the committed file differs from a fresh build (CI guard)

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseHtml } from "node-html-parser";
import YAML from "yaml";

const MAX_CHUNK = 900; // characters; keeps retrieved context small for the LLM
const MIN_CHUNK = 60;
const MAX_CHUNKS_PER_PAGE = 14;

const TYPE_LABEL = {
  profile: "Profile",
  contact: "Contact",
  experience: "Experience",
  project: "Project",
  opensource: "Open source",
  education: "Education",
  skills: "Skills",
  honor: "Honor",
  publication: "Publication",
  post: "Blog",
  note: "Note",
};

// Search aliases per type (Vietnamese + English) so "kinh nghiệm", "bài báo khoa học" etc. reach the right
// type even with no literal keyword match. They are search aids only; they are never shown to the LLM.
const TYPE_KEYWORDS = {
  profile: "giới thiệu bản thân tóm tắt about summary overview hồ sơ",
  contact: "liên hệ email contact linkedin github mạng xã hội social",
  experience: "kinh nghiệm làm việc công ty vị trí experience career job work history resume cv",
  project: "dự án sản phẩm project product demo triển khai production",
  opensource: "mã nguồn mở đóng góp pull request open source contribution merged pr",
  education: "học vấn trường đại học thạc sĩ cử nhân education university degree master bachelor",
  skills: "kỹ năng công nghệ stack tooling skills technology công cụ",
  honor: "giải thưởng thành tích cuộc thi honor award competition challenge",
  publication: "bài báo khoa học công bố nghiên cứu paper publication research journal conference",
  post: "bài viết blog article post tutorial hướng dẫn",
  note: "ghi chú note",
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const clean = (s) => s.replace(/\s+/g, " ").trim();
// join fragments with ". " without doubling punctuation
const joinSentences = (parts, sep = ". ") =>
  parts.filter(Boolean).reduce((acc, p) => (acc ? acc + (/[.!?]$/.test(acc) && sep === ". " ? " " : sep) + p : p), "");
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function readYaml(path, fallback) {
  return existsSync(path) ? YAML.parse(readFileSync(path, "utf8")) ?? fallback : fallback;
}

function splitFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  return { data: YAML.parse(m[1]) ?? {}, body: m[2] };
}

// ---- markdown -> plain text ------------------------------------------------------------------

// Fenced code blocks: a fence line with an info string (```python) always opens a block, so one stray or
// unbalanced fence in the source cannot invert the state for the rest of the file.
function nextFence(line, inFence) {
  const f = line.match(/^\s*(```|~~~)\s*(\S*)/);
  if (!f) return { fence: inFence, isFenceLine: false };
  return { fence: inFence ? Boolean(f[2]) : true, isFenceLine: true };
}

function stripFences(md) {
  let fence = false;
  const out = [];
  for (const line of md.split("\n")) {
    const r = nextFence(line, fence);
    fence = r.fence;
    if (!fence && !r.isFenceLine) out.push(line);
  }
  return out.join("\n");
}

// Lines that look like credentials never enter the index: the assistant would happily quote them.
const SENSITIVE_LINE = /\b(password|passwd|pwd|secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token|bearer)\b/i;
const dropSensitive = (md) => md.split("\n").filter((l) => !SENSITIVE_LINE.test(l)).join("\n");

function mdToPlain(md) {
  return (
    dropSensitive(stripFences(md.replace(/\r/g, "")))
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "") // [![badge](img)](link)
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\[[^\]]*\]/g, "") // [![badge](img)][ref]
      .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "") // link reference definitions (badges)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
      .replace(/<img[^>]*>/gi, "")
      .replace(/\[\s*\]\([^)]*\)|\[\s*\]\[[^\]]*\]/g, "") // links left empty after removing images
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) -> text
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(?<![\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, "") // table separators
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// kramdown-style auto id for a heading (what Jekyll gives `## Some Heading`)
function headingId(text) {
  const id = text
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/^[^\p{L}]+/u, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return id;
}

function splitSections(body) {
  // [{ heading, level, text }] split on # / ## / ### outside fenced code
  const lines = body.replace(/\r/g, "").split("\n");
  const out = [];
  let cur = { heading: "", level: 0, lines: [] };
  let fence = false;
  for (const line of lines) {
    fence = nextFence(line, fence).fence;
    const h = !fence && line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (h) {
      out.push(cur);
      cur = { heading: mdToPlain(h[2]), level: h[1].length, lines: [] };
    } else cur.lines.push(line);
  }
  out.push(cur);
  return out.map((s) => ({ ...s, text: mdToPlain(s.lines.join("\n")) }));
}

function packParagraphs(text, max = MAX_CHUNK) {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let cur = "";
  for (let p of paras) {
    while (p.length > max) {
      const cut = p.lastIndexOf(" ", max);
      const at = cut > max * 0.5 ? cut : max;
      if (cur) { out.push(cur); cur = ""; }
      out.push(p.slice(0, at).trim());
      p = p.slice(at).trim();
    }
    if ((cur + "\n\n" + p).length > max && cur) { out.push(cur); cur = p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

function pageChunks({ idBase, type, pageTitle, url, body, intro = "" }) {
  const chunks = [];
  const sections = splitSections(body);
  let n = 0;
  for (const sec of sections) {
    const text = [n === 0 && intro ? intro : "", sec.text].filter(Boolean).join("\n\n");
    if (text.length < MIN_CHUNK && !(n === 0 && intro)) continue;
    const anchor = sec.heading && sec.level > 1 ? "#" + headingId(sec.heading) : "";
    const title = sec.heading && sec.level > 1 ? `${pageTitle} — ${sec.heading}` : pageTitle;
    const pieces = packParagraphs(text);
    pieces.forEach((piece, i) => {
      if (piece.length < MIN_CHUNK && chunks.length) return;
      chunks.push({
        id: `${idBase}-${++n}`,
        type,
        title: i ? `${title} (${i + 1})` : title,
        text: piece,
        url: url + (anchor.length > 1 ? anchor : ""),
        dedupe: url,
      });
    });
  }
  return chunks.slice(0, MAX_CHUNKS_PER_PAGE);
}

// ---- sources ---------------------------------------------------------------------------------

function cvChunks(root) {
  const cv = readYaml(join(root, "_data/cv.yml"), {}) ?? {};
  const out = [];
  const c = (id, type, title, text, url, extra = {}) =>
    out.push({ id, type, title, text: clean(text), url, dedupe: url + "#" + id, core: true, ...extra });
  if (cv.person?.summary) c("about", "profile", "About", cv.person.summary, "/about/");
  for (const x of cv.experience ?? []) {
    c(`exp-${x.id}`, "experience", `${x.role} · ${x.company}`,
      joinSentences([`${x.role} · ${x.company}`, `${x.from} — ${x.to}${x.duration ? " · " + x.duration : ""}`, x.place, x.current && "Current role", x.note]),
      `/about/#exp-${x.id}`);
  }
  for (const x of cv.education ?? []) {
    c(`edu-${x.id}`, "education", x.degree, joinSentences([x.degree, x.school, x.years]), `/about/#edu-${x.id}`);
  }
  for (const x of cv.honors ?? []) {
    c(`honor-${x.id}`, "honor", `${x.event} ${x.year} — ${x.result}`, `${x.event} ${x.year} — ${x.result}`, "/about/#honors");
  }
  for (const x of cv.opensource ?? []) {
    c(`oss-${x.id}`, "opensource", x.repo,
      joinSentences([x.repo, x.desc, `${x.prs} merged PR${x.prs > 1 ? "s" : ""}${x.tags ? " · " + x.tags : ""}`]),
      `/about/#oss-${x.id}`, { ext: x.url });
  }
  if (cv.websites?.length) {
    c("websites", "project", "Live websites",
      "Public websites: " + cv.websites.map((w) => `${w.name} (${w.url}) — ${w.desc}`).join(" "), "/about/#websites");
  }
  if (cv.skills?.length) {
    c("skills", "skills", "Focus & tooling",
      "Focus and tooling. " + cv.skills.map((g) => `${g.label}: ${g.items.join(", ")}`).join(". "), "/about/#skills");
  }
  return out;
}

function configChunks(cfg) {
  const a = cfg.author ?? {};
  const links = [
    a.github && `GitHub: https://github.com/${a.github}`,
    a.linkedin && `LinkedIn: https://www.linkedin.com/in/${a.linkedin}`,
    a.email && `Email: ${a.email}`,
  ].filter(Boolean);
  return [
    {
      id: "profile",
      type: "profile",
      title: cfg.name ?? a.name,
      text: clean(`${cfg.name ?? a.name} — ${a.bio ?? ""}. Based in ${a.location ?? "n/a"}. ${cfg.description ?? ""}`),
      url: "/about/",
      dedupe: "/about/#profile",
      core: true,
    },
    {
      id: "contact",
      type: "contact",
      title: "Contact & links",
      text: links.join(". "),
      url: "/contact/",
      dedupe: "/contact/#contact",
      core: true,
    },
  ];
}

function collectionChunks(root, dir, type, urlFor) {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  const out = [];
  for (const file of readdirSync(base).filter((f) => /\.(md|markdown)$/.test(f)).sort()) {
    const { data, body } = splitFrontMatter(readFileSync(join(base, file), "utf8"));
    if (data.published === false) continue;
    const name = basename(file).replace(/\.(md|markdown)$/, "");
    const slug = name.replace(/^\d{4}-\d{2}-\d{2}-/, "");
    const title = String(data.title ?? slug);
    const url = data.permalink ?? urlFor({ slug, data });
    const meta = [
      type === "publication" && data.venue && `Venue: ${data.venue}`,
      data.date && type !== "project" && `Date: ${new Date(data.date).toISOString().slice(0, 10)}`,
      data.citation && `Citation: ${clean(String(data.citation))}`,
      data.paperurl && `Paper: ${data.paperurl}`,
    ].filter(Boolean).join(". ");
    const excerpt = type === "project" ? mdToPlain(String(data.excerpt ?? [data.tagline, data.summary].filter(Boolean).join("\n\n"))) : "";
    if (type === "project" && data.tagline) {
      const year = data.date ? new Date(data.date).toISOString().slice(0, 4) : "";
      out.push({
        id: `work-${data.cover ? basename(String(data.cover)).replace(/\.\w+$/, "") : slug}`,
        type: "project",
        title: String(data.card_title ?? title),
        text: clean(joinSentences([String(data.card_title ?? title), data.tagline, data.summary,
          data.role && `Role: ${data.role}`, data.stack && `Stack: ${data.stack}`, year && `Year: ${year}`, data.result])),
        url,
        dedupe: url,
        core: true,
        ...(data.live || data.repo ? { ext: data.live ?? data.repo } : {}),
      });
    }
    out.push(
      ...pageChunks({
        idBase: `${type}-${slug}`,
        type,
        pageTitle: title,
        url,
        body,
        intro: [meta, excerpt].filter(Boolean).join("\n\n"),
      }),
    );
  }
  return out;
}

function extraChunks(profile) {
  return (profile.facts ?? []).map((f, i) => {
    if (!f.title || !f.text) throw new Error(`_data/profile.yml facts[${i}] needs title and text`);
    const type = f.type ?? "note";
    if (!(type in TYPE_LABEL)) throw new Error(`_data/profile.yml facts[${i}]: unknown type "${type}"`);
    return {
      id: f.id ?? `fact-${slugify(f.title)}`,
      type,
      title: String(f.title),
      text: clean(String(f.text)),
      url: f.url ?? "/",
      dedupe: f.url ?? `/#fact-${i}`,
      core: f.core !== false,
      ...(f.keywords ? { kw: [].concat(f.keywords).join(" ") } : {}),
    };
  });
}

// ---- build -----------------------------------------------------------------------------------

export function buildKb(root = ROOT) {
  const cfg = readYaml(join(root, "_config.yml"), {});
  const profile = readYaml(join(root, "_data/profile.yml"), {}) ?? {};
  const nav = readYaml(join(root, "_data/navigation.yml"), {});

  const chunks = [
    ...configChunks(cfg),
    ...cvChunks(root),
    ...extraChunks(profile),
    ...collectionChunks(root, "_projects", "project", ({ slug }) => `/projects/${slug}/`),
    ...collectionChunks(root, "_publications", "publication", ({ slug }) => `/publications/${slug}/`),
    ...collectionChunks(root, "_posts", "post", ({ slug, data }) => {
      const cats = [].concat(data.categories ?? data.category ?? []).filter(Boolean);
      return "/" + [...cats, slug].join("/") + "/";
    }),
  ];

  const ids = new Set();
  for (const c of chunks) {
    if (ids.has(c.id)) throw new Error(`duplicate chunk id "${c.id}"`);
    ids.add(c.id);
    const kw = [TYPE_KEYWORDS[c.type], profile.keywords?.[c.id], c.kw].filter(Boolean).join(" ");
    c.kw = kw;
    c.label = TYPE_LABEL[c.type];
  }

  const links = {
    github: cfg.author?.github && `https://github.com/${cfg.author.github}`,
    linkedin: cfg.author?.linkedin && `https://www.linkedin.com/in/${cfg.author.linkedin}`,
    email: cfg.author?.email && `mailto:${cfg.author.email}`,
  };

  const hash = createHash("sha1").update(JSON.stringify(chunks)).digest("hex").slice(0, 10);
  return {
    version: 1,
    hash,
    suggestions: cfg.command_palette?.suggestions ?? [],
    site: { name: cfg.name ?? cfg.author?.name, url: cfg.url },
    nav: (nav.main ?? []).map((n) => ({ title: n.title, url: n.url })),
    links,
    chunks,
  };
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : "assets/data/kb.json");
  const kb = buildKb();
  const json = JSON.stringify(kb, null, 1) + "\n";

  if (args.includes("--check")) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current !== json) {
      console.error(`${out} is stale. Run: node scripts/build-kb.mjs`);
      process.exit(1);
    }
    console.log(`kb.json is up to date (${kb.chunks.length} chunks, hash ${kb.hash})`);
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  const core = kb.chunks.filter((c) => c.core);
  const bytes = (cs) => cs.reduce((n, c) => n + c.text.length, 0);
  console.log(
    `wrote ${out}\n  ${kb.chunks.length} chunks (${core.length} core / ${bytes(core)} chars always in LLM context, ` +
      `${kb.chunks.length - core.length} retrievable / ${bytes(kb.chunks) - bytes(core)} chars), hash ${kb.hash}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
