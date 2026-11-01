/* ⌘K command palette: site navigation + in-browser semantic search + "ask my profile" (micro-RAG).
 *
 *  - kb.json (built by scripts/build-kb.mjs) is the whole knowledge base: CV, projects, posts, publications.
 *  - Keyword search works instantly. A small multilingual embedding model runs in a Web Worker
 *    (assets/js/palette.worker.js) and is fused with it, so "kinh nghiệm tối ưu phần cứng" can find
 *    a project that never uses those words.
 *  - "Ask AI" sends the question + the ids of the best-matching passages to a Cloudflare Worker
 *    (workers/ask) that answers with Workers AI, grounded in the same kb.json, and streams it back.
 */
(() => {
  "use strict";

  const cfgEl = document.getElementById("cmdk-config");
  if (!cfgEl) return;
  const cfg = JSON.parse(cfgEl.textContent);

  // ---- strings (edit here to translate) ---------------------------------------------------------
  const T = {
    placeholder: "Tìm kiếm hoặc hỏi về hồ sơ…",
    placeholderAsk: "Hỏi tiếp một câu khác…",
    suggestions: "Gợi ý hỏi AI",
    navigate: "Điều hướng",
    results: "Trong hồ sơ",
    ask: "Hỏi AI",
    askRow: (q) => `Hỏi AI: “${q}”`,
    askSub: "Trả lời dựa trên CV, dự án, bài viết và công bố của tôi",
    none: "Không tìm thấy kết quả nào. Thử hỏi AI bên dưới.",
    back: "← Quay lại tìm kiếm",
    sources: "Nguồn",
    thinking: "Đang tìm trong hồ sơ…",
    noBackend: "Chưa kết nối trợ lý AI (Cloudflare Worker), nên đây là các đoạn liên quan nhất tìm được trong hồ sơ:",
    failed: "Trợ lý AI đang bận hoặc không phản hồi. Đây là các đoạn liên quan nhất tìm được trong hồ sơ:",
    limited: "Bạn hỏi hơi nhanh, thử lại sau ít phút nhé.",
    semOff: "Tìm theo ngữ nghĩa: tắt",
    semEnable: (mb) => `Bật (tải mô hình ≈${mb} MB, một lần)`,
    semLoading: (p) => `Ngữ nghĩa: đang tải mô hình${p != null ? ` ${p}%` : "…"}`,
    semIndexing: (p) => `Ngữ nghĩa: đang lập chỉ mục ${p}%`,
    semReady: "Ngữ nghĩa: sẵn sàng",
    semError: "Ngữ nghĩa: lỗi, dùng tìm theo từ khóa",
    kUp: "chọn", kOpen: "mở", kAsk: "hỏi AI", kClose: "đóng",
    askLabel: "Hỏi AI",
    close: "Đóng",
    emailCopied: "Đã sao chép email",
  };

  const SUGGESTIONS = cfg.suggestions || [];
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  const MOD = isMac ? "⌘" : "Ctrl";

  // ---- text helpers -----------------------------------------------------------------------------
  const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
  const STOP = new Set(
    ("a an the of in on to for and or with is are was be by at as it this that my me i " +
      "va la cua cac nhung voi cho mot co duoc trong khi tu den ve nao gi nhu da se rat toi minh ban nhat").split(" "),
  );
  const tok = (s) => fold(s).split(/[^a-z0-9+#]+/).filter((t) => t && !STOP.has(t));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

  // ---- state ------------------------------------------------------------------------------------
  const S = {
    open: false,
    mode: "search", // 'search' | 'ask'
    kb: null,
    lex: null,
    items: [],
    active: 0,
    query: "",
    prevFocus: null,
    sem: { state: "idle", pct: null, phase: null, worker: null, qid: 0, pending: new Map() },
    abort: null,
  };
  let ui = null; // DOM refs, built on first open

  // ---- knowledge base + keyword index -------------------------------------------------------------
  async function loadKb() {
    if (S.kb) return S.kb;
    if (!S.kbPromise) {
      S.kbPromise = fetch(cfg.kb, { credentials: "omit" })
        .then((r) => { if (!r.ok) throw new Error("kb " + r.status); return r.json(); })
        .then((kb) => { S.kb = kb; S.lex = buildLex(kb.chunks); return kb; });
    }
    return S.kbPromise;
  }

  function buildLex(chunks) {
    const df = new Map();
    const docs = chunks.map((c) => {
      const title = tok(c.title);
      const body = tok(c.text + " " + (c.kw || ""));
      const tf = new Map();
      body.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      const tset = new Set(title);
      new Set([...tset, ...tf.keys()]).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
      return { tset, tf };
    });
    return { docs, df, n: docs.length };
  }

  // Returns ranked [docIndex, score] pairs. `nav` is true for navigational queries: the best hit's title
  // contains every query token ("viact", "goodjobs", "qualcomm"), i.e. the visitor named the thing.
  function lexSearch(q) {
    const L = S.lex;
    const out = [];
    out.nav = false;
    if (!L) return out;
    const qt = [...new Set(tok(q))];
    if (!qt.length) return out;
    const inTitle = (d, t) => d.tset.has(t) || (t.length >= 3 && [...d.tset].some((k) => k.startsWith(t)));
    L.docs.forEach((d, i) => {
      let score = 0;
      let matched = 0;
      for (const t of qt) {
        const idf = Math.log(1 + L.n / (1 + (L.df.get(t) || 0)));
        let hit = 0;
        if (d.tset.has(t)) hit += 2;
        else if (t.length >= 3) for (const k of d.tset) if (k.startsWith(t)) { hit += 1.2; break; }
        const f = d.tf.get(t);
        if (f) hit += 1 + Math.log(f);
        else if (t.length >= 3) for (const k of d.tf.keys()) if (k.startsWith(t)) { hit += 0.6; break; }
        if (hit) matched++;
        score += idf * hit;
      }
      if (score > 0) out.push([i, score * (0.5 + (0.5 * matched) / qt.length)]);
    });
    out.sort((a, b) => b[1] - a[1]);
    out.nav = out.length > 0 && qt.every((t) => inTitle(L.docs[out[0][0]], t));
    return out;
  }

  // ---- semantic search (Web Worker) ---------------------------------------------------------------
  const semanticAllowed = () => cfg.semantic !== "off" && typeof Worker !== "undefined" && typeof indexedDB !== "undefined";

  function semanticWantedAuto() {
    const pref = safeGet("cmdk-semantic");
    if (pref === "off") return false;
    if (pref === "on") return true;
    if (cfg.semantic !== "auto") return false;
    const c = navigator.connection || {};
    const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    return !(c.saveData || coarse || /(^|-)(2|3)g$/.test(c.effectiveType || ""));
  }

  function startSemantic() {
    const sem = S.sem;
    if (!semanticAllowed() || sem.worker || sem.state === "error") return;
    loadKb().then((kb) => {
      try {
        sem.worker = new Worker(cfg.worker, { type: "module" });
      } catch (err) {
        sem.state = "error"; renderFoot(); return;
      }
      sem.state = "loading";
      sem.pct = null;
      sem.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "progress") { sem.phase = m.phase; sem.pct = m.pct; }
        else if (m.type === "ready") { sem.state = "ready"; sem.pct = null; if (S.open && S.mode === "search" && ui.input.value.trim()) refresh(); }
        else if (m.type === "result") { const r = sem.pending.get(m.qid); if (r) { sem.pending.delete(m.qid); r(m.hits); } }
        else if (m.type === "error") { sem.state = "error"; sem.pending.forEach((r) => r([])); sem.pending.clear(); }
        renderFoot();
      };
      sem.worker.onerror = () => { sem.state = "error"; sem.pending.forEach((r) => r([])); sem.pending.clear(); renderFoot(); };
      sem.worker.postMessage({
        type: "init",
        transformersUrl: cfg.transformers,
        model: cfg.model,
        dtype: cfg.dtype,
        queryPrefix: cfg.queryPrefix,
        passagePrefix: cfg.passagePrefix,
        kbHash: kb.hash,
        docs: kb.chunks.map((c) => `${c.title}. ${c.text}`.slice(0, 1400)),
      });
      renderFoot();
    });
  }

  function semQuery(text) {
    const sem = S.sem;
    if (sem.state !== "ready" || !sem.worker) return Promise.resolve([]);
    const qid = ++sem.qid;
    return new Promise((resolve) => {
      sem.pending.set(qid, resolve);
      sem.worker.postMessage({ type: "query", qid, text, k: 12 });
      setTimeout(() => { if (sem.pending.delete(qid)) resolve([]); }, 8000);
    });
  }

  // ---- ranking: keyword + semantic fused (reciprocal rank fusion), de-duplicated by page -----------
  async function rank(q, { includeCore = true } = {}) {
    const chunks = S.kb.chunks;
    const lexAll = lexSearch(q);
    const lex = lexAll.slice(0, 20);
    let sem = await semQuery(q);
    if (sem.length) {
      const best = sem[0][1];
      sem = sem.filter(([, s]) => s >= best - cfg.semanticWindow).slice(0, 10);
    }
    const via = new Map();
    const rrf = new Map();
    // A navigational query names the thing, so the exact keyword hit must win over embedding neighbours
    // (embedding models are arbitrary on names they have never seen). Otherwise fuse both lists evenly.
    const wLex = lexAll.nav ? 3 : 1;
    lex.forEach(([i], r) => { rrf.set(i, (rrf.get(i) || 0) + wLex / (60 + r)); via.set(i, new Set(["kw"])); });
    sem.forEach(([i], r) => { rrf.set(i, (rrf.get(i) || 0) + 1.15 / (60 + r)); (via.get(i) || via.set(i, new Set()).get(i)).add("sem"); });
    const seen = new Set();
    const hits = [];
    for (const [i] of [...rrf.entries()].sort((a, b) => b[1] - a[1])) {
      const c = chunks[i];
      if (!includeCore && c.core) continue;
      if (seen.has(c.dedupe)) continue;
      seen.add(c.dedupe);
      hits.push({ chunk: c, via: via.get(i) });
    }
    return hits;
  }

  // ---- commands -----------------------------------------------------------------------------------
  function commands() {
    const kb = S.kb;
    const base = (kb.nav || []).map((n) => ({
      title: n.title, sub: n.url, keys: n.title + " " + n.url, run: () => go(n.url),
    }));
    const L = kb.links || {};
    const extra = [
      { title: "Chuyển giao diện sáng / tối", sub: "Toggle theme", keys: "theme dark light giao dien sang toi mode", run: () => document.querySelector(".theme-toggle")?.click(), stay: true },
      L.github && { title: "GitHub", sub: L.github, keys: "github code repo source", run: () => window.open(L.github, "_blank", "noopener") },
      L.linkedin && { title: "LinkedIn", sub: L.linkedin, keys: "linkedin social network", run: () => window.open(L.linkedin, "_blank", "noopener") },
      L.email && { title: "Gửi email", sub: L.email.replace("mailto:", ""), keys: "email mail contact lien he", run: () => { location.href = L.email; } },
      L.email && {
        title: "Sao chép email", sub: L.email.replace("mailto:", ""), keys: "copy email sao chep",
        run: () => navigator.clipboard?.writeText(L.email.replace("mailto:", "")).then(() => toast(T.emailCopied)).catch(() => {}),
      },
    ].filter(Boolean);
    return [...base, ...extra];
  }

  // ---- navigation (same page: scroll + flash; other page: load, flash on arrival) ----------------
  function go(url) {
    const base = (cfg.baseurl || "") + url;
    const u = new URL(base, location.href);
    close();
    if (u.origin === location.origin && u.pathname === location.pathname) {
      if (u.hash) { history.pushState(null, "", u.hash); flash(u.hash.slice(1)); }
      else window.scrollTo({ top: 0, behavior: "smooth" });
    } else location.assign(u.href);
  }

  function flash(id) {
    if (!id) return;
    const t = document.getElementById(decodeURIComponent(id));
    if (!t) return;
    t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    t.classList.remove("cmdk-flash");
    void t.offsetWidth; // restart the animation
    t.classList.add("cmdk-flash");
    setTimeout(() => t.classList.remove("cmdk-flash"), 2600);
  }
  window.addEventListener("hashchange", () => flash(location.hash.slice(1)));
  if (location.hash.length > 1) addEventListener("load", () => setTimeout(() => flash(location.hash.slice(1)), 250));

  function toast(msg) {
    if (!ui) return;
    ui.live.textContent = msg;
  }

  // ---- DOM ------------------------------------------------------------------------------------------
  function build() {
    const overlay = el("div", "cmdk-overlay");
    overlay.innerHTML = `
      <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmdk-bar">
          <span class="cmdk-ico" aria-hidden="true">⌕</span>
          <input class="cmdk-input" type="text" role="combobox" aria-expanded="true" aria-controls="cmdk-list"
                 aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"
                 placeholder="${esc(T.placeholder)}" aria-label="${esc(T.placeholder)}">
          <button type="button" class="cmdk-esc" aria-label="${esc(T.close)}">esc</button>
        </div>
        <div class="cmdk-body"></div>
        <div class="cmdk-foot">
          <div class="keys">
            <span class="k-search"><kbd>↑</kbd><kbd>↓</kbd> ${esc(T.kUp)}</span>
            <span class="k-search"><kbd>↵</kbd> ${esc(T.kOpen)}</span>
            <span><kbd>${MOD}</kbd><kbd>↵</kbd> ${esc(T.kAsk)}</span>
            <span><kbd>esc</kbd> ${esc(T.kClose)}</span>
          </div>
          <span class="grow"></span>
          <span class="cmdk-sem" data-state="idle"><i></i><span class="cmdk-sem-text"></span></span>
        </div>
        <div class="sr-only" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"></div>
      </div>`;
    document.body.appendChild(overlay);
    const panel = overlay.querySelector(".cmdk-panel");
    ui = {
      overlay, panel,
      input: panel.querySelector(".cmdk-input"),
      body: panel.querySelector(".cmdk-body"),
      sem: panel.querySelector(".cmdk-sem"),
      semText: panel.querySelector(".cmdk-sem-text"),
      live: panel.querySelector("[aria-live]"),
    };
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    panel.querySelector(".cmdk-esc").addEventListener("click", close);
    ui.input.addEventListener("input", onInput);
    ui.input.addEventListener("keydown", onInputKey);
    panel.addEventListener("keydown", trapTab);
    ui.body.addEventListener("click", onBodyClick);
    ui.body.addEventListener("mousemove", (e) => {
      const li = e.target.closest?.(".cmdk-item");
      if (li && +li.dataset.i !== S.active) setActive(+li.dataset.i, false);
    });
    ui.sem.addEventListener("click", (e) => {
      if (e.target.dataset.act === "enable") { safeSet("cmdk-semantic", "on"); startSemantic(); }
    });
  }

  function renderFoot() {
    if (!ui) return;
    const s = S.sem;
    let state = s.state;
    let html;
    if (state === "idle") {
      state = semanticAllowed() ? "idle" : "error";
      html = semanticAllowed() ? `${esc(T.semOff)} · <button type="button" data-act="enable">${esc(T.semEnable(cfg.modelMb))}</button>` : esc(T.semError);
    } else if (state === "loading") html = esc(s.phase === "index" ? T.semIndexing(s.pct ?? 0) : T.semLoading(s.pct));
    else if (state === "ready") html = esc(T.semReady);
    else html = esc(T.semError);
    ui.sem.dataset.state = state;
    ui.semText.innerHTML = html;
  }

  // ---- open / close ---------------------------------------------------------------------------------
  async function open(prefill) {
    if (S.open) { ui.input.focus(); return; }
    if (!ui) build();
    S.open = true;
    S.prevFocus = document.activeElement;
    ui.overlay.classList.add("is-open");
    document.documentElement.style.overflow = "hidden";
    setMode("search");
    ui.input.value = prefill || "";
    ui.input.focus();
    renderFoot();
    try { await loadKb(); } catch { ui.body.innerHTML = `<div class="cmdk-empty">Không tải được dữ liệu hồ sơ.</div>`; return; }
    if (semanticWantedAuto()) startSemantic();
    renderFoot();
    refresh();
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    S.abort?.abort();
    ui.overlay.classList.remove("is-open");
    document.documentElement.style.overflow = "";
    ui.input.blur(); // don't leave focus on a hidden element (it would also swallow the "/" shortcut)
    S.prevFocus?.focus?.();
  }

  function setMode(mode) {
    S.mode = mode;
    ui.panel.dataset.mode = mode;
    ui.input.placeholder = mode === "ask" ? T.placeholderAsk : T.placeholder;
    ui.input.setAttribute("role", mode === "ask" ? "textbox" : "combobox");
  }

  // ---- search view --------------------------------------------------------------------------------------
  let refreshTimer = 0;
  let refreshSeq = 0;
  function onInput() {
    if (S.mode !== "search") return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, S.sem.state === "ready" ? 140 : 60);
  }

  async function refresh() {
    if (!S.kb || S.mode !== "search") return;
    const seq = ++refreshSeq;
    const q = ui.input.value.trim();
    S.query = q;
    const items = [];
    const cmds = commands();

    if (!q) {
      SUGGESTIONS.forEach((s) => items.push({ group: T.suggestions, badge: "AI", badgeCls: "t-ai", title: s, sub: "", run: () => ask(s) }));
      cmds.forEach((c) => items.push({ group: T.navigate, badge: "Go", badgeCls: "t-cmd", title: c.title, sub: c.sub, run: c.run }));
    } else {
      const fq = fold(q);
      const matchCmds = cmds.filter((c) => fold(c.keys).includes(fq) || fold(c.title).includes(fq)).slice(0, 3);
      matchCmds.forEach((c) => items.push({ group: T.navigate, badge: "Go", badgeCls: "t-cmd", title: c.title, sub: c.sub, run: c.run }));
      const hits = await rank(q);
      if (seq !== refreshSeq) return; // a newer keystroke superseded this one
      hits.slice(0, 7).forEach(({ chunk, via }) => items.push({
        group: T.results,
        badge: chunk.label,
        title: chunk.title,
        sub: chunk.text,
        via: via.has("sem") && !via.has("kw") ? "≈ ngữ nghĩa" : via.has("sem") ? "≈ + từ khóa" : "",
        ext: chunk.ext,
        run: () => go(chunk.url),
      }));
      if (!hits.length && !matchCmds.length) items.push({ group: "", empty: T.none });
      items.push({ group: T.ask, badge: "AI", badgeCls: "t-ai", title: T.askRow(q), sub: T.askSub, run: () => ask(q) });
    }
    S.items = items;
    S.active = Math.max(0, items.findIndex((i) => !i.empty));
    renderList();
  }

  function renderList() {
    ui.body.textContent = "";
    const ul = el("ul", "cmdk-list");
    ul.id = "cmdk-list";
    ul.setAttribute("role", "listbox");
    ul.setAttribute("aria-label", "Kết quả");
    let lastGroup = null;
    S.items.forEach((it, i) => {
      if (it.group && it.group !== lastGroup) { const g = el("li", "cmdk-group", esc(it.group)); g.setAttribute("role", "presentation"); ul.appendChild(g); lastGroup = it.group; }
      if (it.empty) { const li = el("li", "cmdk-empty", esc(it.empty)); li.setAttribute("role", "presentation"); ul.appendChild(li); return; }
      const li = el("li", "cmdk-item");
      li.id = "cmdk-opt-" + i;
      li.dataset.i = i;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === S.active ? "true" : "false");
      li.innerHTML =
        `<span class="cmdk-badge ${it.badgeCls || ""}">${esc(it.badge)}</span>` +
        `<span class="cmdk-main"><span class="cmdk-title" style="display:block">${esc(it.title)}</span>` +
        (it.sub ? `<span class="cmdk-sub">${esc(it.sub)}</span>` : "") + `</span>` +
        (it.via ? `<span class="cmdk-via">${esc(it.via)}</span>` : "") +
        (it.ext ? `<a class="cmdk-ext" href="${esc(it.ext)}" target="_blank" rel="noopener" aria-label="Mở liên kết ngoài">↗</a>` : "") +
        `<span class="cmdk-go" aria-hidden="true">↵</span>`;
      ul.appendChild(li);
    });
    ui.body.appendChild(ul);
    syncActive();
  }

  function syncActive() {
    const opts = ui.body.querySelectorAll(".cmdk-item");
    opts.forEach((o) => o.setAttribute("aria-selected", +o.dataset.i === S.active ? "true" : "false"));
    const cur = ui.body.querySelector(`#cmdk-opt-${S.active}`);
    if (cur) { ui.input.setAttribute("aria-activedescendant", cur.id); cur.scrollIntoView({ block: "nearest" }); }
    else ui.input.removeAttribute("aria-activedescendant");
  }

  function setActive(i, scroll = true) {
    S.active = i;
    const opts = ui.body.querySelectorAll(".cmdk-item");
    opts.forEach((o) => o.setAttribute("aria-selected", +o.dataset.i === i ? "true" : "false"));
    const cur = ui.body.querySelector(`#cmdk-opt-${i}`);
    if (cur) { ui.input.setAttribute("aria-activedescendant", cur.id); if (scroll) cur.scrollIntoView({ block: "nearest" }); }
  }

  function move(delta) {
    const idx = S.items.map((it, i) => (it.empty ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return;
    const pos = idx.indexOf(S.active);
    setActive(idx[(pos + delta + idx.length) % idx.length]);
  }

  function onBodyClick(e) {
    if (e.target.closest("a.cmdk-ext, a.cmdk-src, a.cmdk-cite")) { close(); return; }
    if (e.target.closest(".cmdk-back")) { backToSearch(); return; }
    const li = e.target.closest(".cmdk-item");
    if (li) S.items[+li.dataset.i]?.run();
  }

  function onInputKey(e) {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (S.mode === "ask") backToSearch(); else close();
    } else if (S.mode === "search" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const q = ui.input.value.trim();
      if (S.mode === "ask" || e.metaKey || e.ctrlKey) { if (q) ask(q); }
      else S.items[S.active]?.run?.();
    }
  }

  function trapTab(e) {
    if (e.key !== "Tab") return;
    const f = [...ui.panel.querySelectorAll("input, button, a[href]")].filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---- ask view (micro-RAG) -----------------------------------------------------------------------------
  function backToSearch() {
    S.abort?.abort();
    setMode("search");
    ui.input.value = S.query || "";
    ui.input.focus();
    refresh();
  }

  function renderMd(text, sources) {
    const cite = (s) => s.replace(/\[(\d{1,2})\]/g, (m, n) => {
      const src = sources[+n - 1];
      return src ? `<a class="cmdk-cite" href="${esc((cfg.baseurl || "") + src.url)}" title="${esc(src.title)}">${n}</a>` : "";
    });
    const inline = (s) => cite(esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>"));
    let html = "";
    let list = null;
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const line of text.replace(/\r/g, "").split("\n")) {
      const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
      if (li) {
        const kind = /\d/.test(li[1]) ? "ol" : "ul";
        if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
        html += `<li>${inline(li[2])}</li>`;
      } else if (line.trim()) { closeList(); html += `<p>${inline(line.trim())}</p>`; }
      else closeList();
    }
    closeList();
    return html;
  }

  function passageList(hits) {
    return hits.map(({ chunk }) => `<li><a class="cmdk-src" style="display:inline-block" href="${esc((cfg.baseurl || "") + chunk.url)}"><b>${esc(chunk.label)}</b>${esc(chunk.title)}</a><div class="cmdk-sub" style="margin:4px 0 8px">${esc(chunk.text.slice(0, 220))}</div></li>`).join("");
  }

  async function ask(question) {
    question = question.trim().slice(0, 500);
    if (!question) return;
    S.abort?.abort();
    S.query = S.mode === "search" ? ui.input.value.trim() : S.query;
    setMode("ask");
    ui.input.value = "";
    ui.input.placeholder = T.placeholderAsk;

    ui.body.innerHTML =
      `<div class="cmdk-ask"><div class="cmdk-q"><span>›</span><span>${esc(question)}</span></div>` +
      `<div class="cmdk-answer is-streaming" aria-live="polite" aria-busy="true"><p class="cmdk-note">${esc(T.thinking)}</p></div>` +
      `<div class="cmdk-sources" hidden></div>` +
      `<button type="button" class="cmdk-back">${esc(T.back)}</button></div>`;
    const answerEl = ui.body.querySelector(".cmdk-answer");
    const srcEl = ui.body.querySelector(".cmdk-sources");
    ui.input.focus();

    // 1. retrieve: best non-core passages (core CV facts are always added by the Worker)
    let hits = [];
    try { await loadKb(); hits = await rank(question, { includeCore: false }); } catch { /* answer without retrieval */ }
    const ids = hits.slice(0, 5).map((h) => h.chunk.id);

    const fallback = (msg) => {
      answerEl.classList.remove("is-streaming");
      answerEl.setAttribute("aria-busy", "false");
      answerEl.innerHTML = `<p class="cmdk-note">${esc(msg)}</p><ul style="list-style:none;margin:0">${passageList(hits.slice(0, 4))}</ul>`;
    };
    if (!cfg.ask) return fallback(T.noBackend);

    // 2. generate: stream the grounded answer from the Cloudflare Worker
    const ctl = (S.abort = new AbortController());
    let sources = [];
    let text = "";
    let refusal = null; // set when the Worker's guardrail filtered the question
    let raf = 0;
    const paint = () => { raf = 0; answerEl.innerHTML = renderMd(text, sources); };
    try {
      const res = await fetch(cfg.ask, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, ids }),
        signal: ctl.signal,
      });
      if (res.status === 429) { answerEl.classList.remove("is-streaming"); answerEl.innerHTML = `<p class="cmdk-note">${esc(T.limited)}</p>`; return; }
      if (!res.ok || !res.body) throw new Error("ask " + res.status);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let event = "message";
          const data = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trim());
          }
          if (!data.length) continue;
          let payload;
          try { payload = JSON.parse(data.join("\n")); } catch { continue; }
          if (event === "sources") sources = payload;
          else if (event === "blocked") refusal = payload.message || "";
          else if (event === "error") throw new Error(payload.message || "ask error");
          else if (event === "message" && payload.t) { text += payload.t; if (!raf) raf = requestAnimationFrame(paint); }
        }
      }
      if (raf) cancelAnimationFrame(raf);
      if (refusal !== null) {
        // off-topic / injection: show the fixed refusal only (no passages, no sources), keep the input ready
        answerEl.classList.remove("is-streaming");
        answerEl.setAttribute("aria-busy", "false");
        answerEl.innerHTML = `<p class="cmdk-note">${esc(refusal)}</p>`;
        return;
      }
      if (!text.trim()) throw new Error("empty answer");
      answerEl.classList.remove("is-streaming");
      answerEl.setAttribute("aria-busy", "false");
      answerEl.innerHTML = renderMd(text, sources);
      // the Worker numbers every passage it gave the model; show only the ones the answer actually cited
      const cited = [...new Set([...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => +m[1]))]
        .filter((n) => sources[n - 1]).sort((a, b) => a - b);
      if (cited.length) {
        srcEl.hidden = false;
        srcEl.innerHTML = `<span class="cmdk-sources-label">${esc(T.sources)}</span>` +
          cited.map((n) => `<a class="cmdk-src" href="${esc((cfg.baseurl || "") + sources[n - 1].url)}"><b>${n}</b>${esc(sources[n - 1].title)}</a>`).join("");
      }
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (raf) cancelAnimationFrame(raf);
      if (text.trim()) { answerEl.classList.remove("is-streaming"); answerEl.innerHTML = renderMd(text, sources); return; }
      fallback(T.failed);
    }
  }

  // ---- global wiring -----------------------------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && k === "k") { e.preventDefault(); S.open ? close() : open(); }
    else if (k === "/" && !e.metaKey && !e.ctrlKey && !S.open) {
      const t = e.target;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      e.preventDefault(); open();
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-cmdk-open]")) { e.preventDefault(); open(); }
  });
  document.querySelectorAll("[data-cmdk-key]").forEach((n) => { n.textContent = MOD === "⌘" ? "⌘K" : "Ctrl K"; });

  // warm the (small) keyword index when the browser is idle so the first ⌘K is instant
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => { loadKb().catch(() => {}); });

  window.cmdk = { open, close };
})();
