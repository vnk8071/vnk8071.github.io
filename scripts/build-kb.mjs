#!/usr/bin/env node
// Builds public/assets/data/kb.json — the static knowledge base behind the ⌘K command palette.
//
// One file feeds three consumers:
//   1. the in-browser semantic / keyword search (assets/js/palette.worker.js)
//   2. the "Ask my profile" micro-RAG (the Cloudflare Worker in workers/ask fetches this same file)
//   3. palette navigation (nav links + social links)
//
// The site itself is plain static HTML (see public/). This script reads the rendered pages so the
// index always matches what visitors see:
//   - public/index.html              profile, contact links, command-palette suggestions
//   - public/about/index.html        experience, education, honours, open source, websites, skills
//   - public/**/index.html           one always-in-context chunk per project, plus the prose by heading
//   - content/profile.yml            extra facts (`facts:`) and search aliases (`keywords:`)
//   - content/navigation.yml         palette navigation links
//
// Usage: node scripts/build-kb.mjs [--out public/assets/data/kb.json] [--check]
//   --check  exit 1 if the committed file differs from a fresh build (CI guard)

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, relative, basename, sep } from "node:path";
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
const SITE = join(ROOT, "public");

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// join fragments with ". " without doubling punctuation
const joinSentences = (parts, sep = ". ") =>
  parts.filter(Boolean).reduce((acc, p) => (acc ? acc + (/[.!?]$/.test(acc) && sep === ". " ? " " : sep) + p : p), "");
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function readYaml(path, fallback) {
  return existsSync(path) ? YAML.parse(readFileSync(path, "utf8")) ?? fallback : fallback;
}

// ---- HTML -> text / markdown ----------------------------------------------------------------

function page(rel, siteDir = SITE) {
  return parseHtml(readFileSync(join(siteDir, rel), "utf8"));
}

const textOf = (el) => clean(el?.text ?? "");
const attr = (el, name) => el?.getAttribute(name) ?? "";

function jsonLd(root) {
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.text);
      return (data["@graph"] ?? [data]).filter(Boolean);
    } catch {
      // ignore malformed blocks
    }
  }
  return [];
}

// The project layout demotes markdown headings by one level (<h1> -> <h2>). Undo that so the
// markdown splitter below sees the same headings the author wrote.
function htmlToMarkdown(rootEl) {
  const blocks = [];
  const push = (s) => {
    const v = clean(s);
    if (v) blocks.push(v);
  };
  const walk = (node) => {
    for (const child of node.childNodes) {
      const tag = (child.rawTagName ?? "").toLowerCase();
      if (!tag) continue;
      if (/^h[1-6]$/.test(tag)) {
        const level = Math.max(1, Number(tag[1]) - 1);
        push("#".repeat(level) + " " + child.text);
      } else if (tag === "p") {
        push(child.text);
      } else if (tag === "ul" || tag === "ol") {
        const items = child.childNodes
          .filter((li) => (li.rawTagName ?? "").toLowerCase() === "li")
          .map((li) => "- " + clean(li.text))
          .filter((li) => li.length > 2);
        if (items.length) blocks.push(items.join("\n"));
      } else if (tag === "table") {
        for (const tr of child.querySelectorAll("tr")) {
          const cells = tr.querySelectorAll("th,td").map(textOf).filter(Boolean);
          if (cells.length) push(cells.join(" | "));
        }
      } else if (tag === "pre" || tag === "script" || tag === "style") {
        continue;
      } else {
        walk(child);
      }
    }
  };
  walk(rootEl);
  return blocks.join("\n\n");
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

// kramdown-style auto id for a heading (what Webflow/Jekyll gives `## Some Heading`)
function headingId(text) {
  return text
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/^[^\p{L}]+/u, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
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

function profileChunks(indexRoot, siteDir = SITE) {
  const graph = jsonLd(indexRoot);
  const person = graph.find((n) => n["@type"] === "Person") ?? {};
  const website = graph.find((n) => n["@type"] === "WebSite") ?? {};
  const address = person.address ?? {};
  const description = attr(indexRoot.querySelector('meta[name="description"]'), "content");
  const about = page("about/index.html", siteDir);
  const aboutText = textOf(about.querySelector(".about_hero-intro h1"));
  return {
    meta: {
      name: person.name ?? "Khoi Vo Nguyen",
      url: (website.url ?? "https://khoispace.io.vn").replace(/\/$/, ""),
    },
    chunks: [
      {
        id: "profile",
        type: "profile",
        title: person.name ?? "Khoi Vo Nguyen",
        text: clean(
          `${person.name ?? "Khoi Vo Nguyen"} — ${person.jobTitle ?? "AI Engineer"} at ${
            person.worksFor?.name ?? "Qualcomm"
          }. Based in ${address.addressLocality ?? "Ho Chi Minh City"}, ${
            address.addressCountry ?? "VN"
          }. ${description}`,
        ),
        url: "/about/",
        dedupe: "/about/#profile",
        core: true,
      },
      aboutText && {
        id: "about",
        type: "profile",
        title: "About",
        text: aboutText,
        url: "/about/",
        dedupe: "/about/#about",
        core: true,
      },
    ].filter(Boolean),
  };
}

function contactChunks(contactRoot) {
  const anchors = contactRoot.querySelectorAll(".contact-direct a");
  const href = (needle) => anchors.find((a) => attr(a, "href").includes(needle))?.getAttribute("href");
  const github = href("github.com");
  const linkedin = href("linkedin.com");
  const email = href("mailto:");
  return [
    {
      id: "contact",
      type: "contact",
      title: "Contact & links",
      text: joinSentences([
        github && `GitHub: ${github}`,
        linkedin && `LinkedIn: ${linkedin}`,
        email && `Email: ${email.replace(/^mailto:/, "")}`,
      ]),
      url: "/contact/",
      dedupe: "/contact/#contact",
      core: true,
    },
  ];
}

function itemText(el) {
  const pos = el.querySelector(".experience-position");
  return {
    label: textOf(pos?.querySelector(".body-text-2")),
    soft: pos?.querySelectorAll(".soft-text").map(textOf) ?? [],
    meta: textOf(el.querySelector(".experiencr-year")),
  };
}

function cvChunks(aboutRoot) {
  const out = [];
  const c = (id, type, title, text, url, extra = {}) =>
    out.push({ id, type, title, text: clean(text), url, dedupe: url + "#" + id, core: true, ...extra });

  for (const el of aboutRoot.querySelectorAll('.experience-item[id^="exp-"]')) {
    const id = attr(el, "id");
    const { label, soft, meta } = itemText(el);
    const [companyPlace = "", note = ""] = soft;
    const [company = companyPlace, ...placeParts] = companyPlace.split(",");
    const place = placeParts.join(",").trim();
    const years = meta.replace(/\s+-\s+/, " — ");
    c(
      id,
      "experience",
      `${label} · ${clean(company)}`,
      joinSentences([`${label} · ${clean(company)}`, years, place, note]),
      `/about/#${id}`,
    );
  }

  for (const el of aboutRoot.querySelectorAll('.experience-item[id^="edu-"]')) {
    const id = attr(el, "id");
    const { label, soft, meta } = itemText(el);
    c(id, "education", label, joinSentences([label, ...soft, meta]), `/about/#${id}`);
  }

  for (const el of aboutRoot.querySelectorAll(".award-wrapper")) {
    const event = textOf(el.querySelector(".display-02"));
    const year = textOf(el.querySelector(".award-title-wrap > div:nth-child(2)"));
    const result = textOf(el.querySelector(".award-bottom-wrap > div:last-child"));
    if (!event || event.includes("/")) continue; // the rest of this strip lists open-source repos
    c(
      `honor-${slugify(`${event} ${year}`)}`,
      "honor",
      `${event} ${year} — ${result}`,
      `${event} ${year} — ${result}`,
      "/about/#honors",
    );
  }

  for (const el of aboutRoot.querySelectorAll('.experience-item[id^="oss-"]')) {
    const id = attr(el, "id");
    const { label, soft, meta } = itemText(el);
    const link = el.querySelector("a");
    c(
      id,
      "opensource",
      label,
      joinSentences([label, ...soft, meta]),
      `/about/#${id}`,
      link ? { ext: attr(link, "href") } : {},
    );
  }

  const websites = [];
  for (const el of aboutRoot.querySelectorAll("#websites .experience-item")) {
    const { label, soft } = itemText(el);
    const link = el.querySelector("a")?.getAttribute("href");
    if (label) websites.push(`${label}${link ? ` (${link})` : ""} — ${soft.join(" ")}`);
  }
  if (websites.length) {
    c(
      "websites",
      "project",
      "Live websites",
      "Public websites: " + joinSentences(websites),
      "/about/#websites",
    );
  }

  const skills = [];
  for (const el of aboutRoot.querySelectorAll("#skills .experience-item")) {
    const { label, soft } = itemText(el);
    if (label) skills.push(`${label}: ${soft.join(" ")}`);
  }
  if (skills.length) {
    c("skills", "skills", "Focus & tooling", "Focus and tooling. " + skills.join(". "), "/about/#skills");
  }

  return out;
}

function htmlFiles(dir = SITE) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "assets" ? [] : htmlFiles(p);
    return entry.name.endsWith(".html") ? [p] : [];
  });
}

function projectChunks(siteDir = SITE) {
  const chunks = [];
  for (const file of htmlFiles(siteDir).sort()) {
    const root = parseHtml(readFileSync(file, "utf8"));
    const prose = root.querySelector(".project-prose");
    if (!prose) continue;

    const rel = relative(siteDir, file).split(sep).join("/").replace(/index\.html$/, "");
    const url = "/" + rel;
    const graph = jsonLd(root);
    const code = graph.find((n) => n["@type"] === "SoftwareSourceCode") ?? {};
    const h1 = textOf(root.querySelector("h1"));
    const title = code.name ?? h1;
    const cardTitle = h1 || title;
    const tagline = textOf(root.querySelector(".global-heading .heading-subtitle"));
    const details = root.querySelectorAll(".project-details-block");
    const summary = textOf(details[0]?.querySelector(".project-details-title"));
    const result = textOf(details[1]?.querySelector(".project-details-title"));
    const facts = {};
    for (const item of details[0]?.querySelectorAll(".project-item") ?? []) {
      const cells = item.querySelectorAll(".body-text-2");
      if (cells.length >= 2) facts[textOf(cells[0])] = textOf(cells[1]);
    }
    const year = facts.Year ?? (code.dateCreated ? String(code.dateCreated).slice(0, 4) : "");
    const cover = basename(attr(root.querySelector(".project-image-wrap img, .projec-image-main"), "src"));
    const slug = cover
      ? cover.replace(/\.\w+$/, "")
      : basename(dirname(file)) === "." ? "home" : basename(dirname(file));
    const ext = attr(root.querySelector(".project-links a"), "href") || undefined;
    const coreText = joinSentences([
      cardTitle,
      tagline,
      summary,
      facts.Role && `Role: ${facts.Role}`,
      facts.Stack && `Stack: ${facts.Stack}`,
      year && `Year: ${year}`,
      result,
    ]);
    chunks.push({
      id: cover ? `work-${cover.replace(/\.\w+$/, "")}` : `work-${slug}`,
      type: "project",
      title: cardTitle,
      text: clean(coreText),
      url,
      dedupe: url,
      core: true,
      ...(ext ? { ext } : {}),
    });

    chunks.push(
      ...pageChunks({
        idBase: `project-${slug}`,
        type: "project",
        pageTitle: title,
        url,
        body: htmlToMarkdown(prose),
        intro: [tagline, summary].filter(Boolean).join("\n\n"),
      }),
    );
  }
  return chunks;
}

function extraChunks(profile) {
  return (profile.facts ?? []).map((f, i) => {
    if (!f.title || !f.text) throw new Error(`content/profile.yml facts[${i}] needs title and text`);
    const type = f.type ?? "note";
    if (!(type in TYPE_LABEL)) throw new Error(`content/profile.yml facts[${i}]: unknown type "${type}"`);
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
  const site = join(root, "public");
  const indexRoot = parseHtml(readFileSync(join(site, "index.html"), "utf8"));
  const aboutRoot = parseHtml(readFileSync(join(site, "about/index.html"), "utf8"));
  const contactRoot = parseHtml(readFileSync(join(site, "contact/index.html"), "utf8"));
  const profile = readYaml(join(root, "content/profile.yml"), {}) ?? {};
  const nav = readYaml(join(root, "content/navigation.yml"), {});
  const cfgJs = readFileSync(join(site, "assets/js/cmdk-config.js"), "utf8");
  const cfgJson = cfgJs.match(/window\.__CMDK_CONFIG__\s*=\s*(\{[\s\S]*?\});/)?.[1];
  if (!cfgJson) throw new Error("public/assets/js/cmdk-config.js must assign window.__CMDK_CONFIG__");
  const palette = JSON.parse(cfgJson);
  const { meta, chunks: baseChunks } = profileChunks(indexRoot, site);

  const chunks = [
    ...baseChunks,
    ...contactChunks(contactRoot),
    ...cvChunks(aboutRoot),
    ...extraChunks(profile),
    ...projectChunks(site),
  ];

  const ids = new Set();
  for (const c of chunks) {
    if (ids.has(c.id)) throw new Error(`duplicate chunk id "${c.id}"`);
    ids.add(c.id);
    const kw = [TYPE_KEYWORDS[c.type], profile.keywords?.[c.id], c.kw].filter(Boolean).join(" ");
    c.kw = kw;
    c.label = TYPE_LABEL[c.type];
  }

  const linkText = chunks.find((c) => c.id === "contact")?.text ?? "";
  const pick = (label) => linkText.match(new RegExp(`${label}: (\\S+)`))?.[1]?.replace(/[.,;]+$/, "");
  const hash = createHash("sha1").update(JSON.stringify(chunks)).digest("hex").slice(0, 10);
  return {
    version: 1,
    hash,
    suggestions: palette.suggestions ?? [],
    site: meta,
    nav: (nav.main ?? []).map((n) => ({ title: n.title, url: n.url })),
    links: {
      github: pick("GitHub"),
      linkedin: pick("LinkedIn"),
      email: pick("Email") && `mailto:${pick("Email")}`,
    },
    chunks,
  };
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : "public/assets/data/kb.json");
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
