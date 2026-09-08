/* Ray 推文卡片工场 —— 无框架单页应用 */

// 后台标签页里 rAF 被冻结，会卡死 html-to-image 导出和卡片测量；隐藏时退化为 setTimeout
const _raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) =>
  document.hidden ? setTimeout(() => cb(performance.now()), 32) : _raf(cb);

const $ = (id) => document.getElementById(id);

const DEFAULT_PROFILE = { name: "长文JayDarwin", handle: "JayDarwinLi", avatar: "jaydarwin-avatar.jpg", verified: true };

/* 抖音安全区：全站唯一真源，画布 px（1080 宽）。虚线参考线和卡片布局都读这份，预览 = 画布 × PREVIEW */
const SAFE = {
  poster: { w: 1080, h: 1440, top: 150, right: 140, bottom: 300, left: 60 },
  tall:   { w: 1080, h: 1920, top: 176, right: 140, bottom: 300, left: 60 },
};
const PREVIEW = 0.5;
/* 抖音右侧互动栏模拟：栏宽（画布 px），用来在右侧留白带里居中 */
const RAIL_W = 96;

/* 正文字号（画布 px，成品 1080 宽下的真实像素）。自动模式从 FONT_BASE 往下调，不往上放大 */
const FONT_BASE = 34, FONT_MIN = 20, FONT_MAX = 48;
/* 字号到底仍超高时允许的整卡微缩下限，再往下就成细长条了，不如放行 */
const RESIDUAL_MIN = 0.75;
/* 纯卡片模式没有画框，宽度固定（画布 px）。908 × PREVIEW × 导出 pixelRatio 3 = 1362，
   与加安全区约束之前的成品尺寸保持一致 */
const CARD_ONLY_W = 908;

const state = {
  profile: { ...DEFAULT_PROFILE },
  posts: [],
  filtered: [],
  selected: null,        // 当前上卡的推文对象
  customText: "",
  tab: "library",        // library | custom
  mode: "poster",        // poster | card
  theme: "light",        // light | dark
  metricsOn: true,
  // 以下几何量统一用画布 px（预览按 PREVIEW 折算），默认锚点是安全区中心
  cardWidth: 100,        // 卡片宽度占安全区宽度的百分比，50–100
  fontSize: FONT_BASE,   // 手动字号（画布 px）
  fontAuto: true,        // 自动缩字号直到内容进安全区
  fitFont: FONT_BASE,    // 实际生效的字号
  fitScale: 1,           // 字号已到底仍超高时的兜底整卡缩放
  cardX: 0,              // 拖动偏移（画布 px，相对安全区中心）
  cardY: 0,
  cardOpacity: 100,
  bgDim: 0,
  guidesOn: true,        // 抖音安全区参考线（仅预览，不进导出）
  search: "",
  chip: { kind: "all", v: "" },
  month: "",
  sort: "new",           // new | hot | saved
  bg: null,              // 当前背景的 URL / dataURL
  fakeMetrics: null,     // 卡片上显示的随机互动数据
  dateOverride: "",      // URL 参数指定的日期
  backgrounds: [],       // manifest 内容，供 bg 参数解析
  bgKey: null,           // 稳定背景标识；本地图片重载 object URL 后仍能保持选中
  bgQuery: "",
  bgLimit: 15,
};

const LIST_CAP = 200;
const BG_DB_NAME = "tweet-card-background-library";
const BG_DB_VERSION = 1;
const BG_DB_STORE = "images";
let backgroundDbPromise = null;

/* ---------- 工具 ---------- */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fmtNum(n) {
  if (n == null) return "0";
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "万";
  if (n >= 1000) return n.toLocaleString("en-US");
  return String(n);
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  return (y === now.getFullYear() ? "" : `${y}年`) + `${m}月${d}日`;
}

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/* ---------- 账号信息（profile.json 默认值 + localStorage 本机覆盖） ---------- */

const PROFILE_KEY = "tcs-profile";
const POSTS_KEY = "tcs-posts";
const POSTS_BUNDLE_VERSION_KEY = "tcs-posts-bundle-version";
const POSTS_BUNDLE_VERSION = "pdf-library-20260908-1";

async function loadProfile(useLocalOverride = true) {
  try {
    const base = await fetch("profile.json?v=jaydarwin-20260908-2").then((r) => (r.ok ? r.json() : {}));
    Object.assign(state.profile, base);
  } catch { /* 没有 profile.json 就用内置默认 */ }
  if (useLocalOverride) {
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      const isLegacyDefault = saved.name === "Ray Wang" && saved.handle === "wangray" && !saved.avatarData;
      if (isLegacyDefault) localStorage.removeItem(PROFILE_KEY);
      else Object.assign(state.profile, saved);
    } catch { /* 本机覆盖损坏则忽略 */ }
  }
  applyProfile();
}

function saveProfileOverride(patch) {
  Object.assign(state.profile, patch);
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    localStorage.setItem(PROFILE_KEY, JSON.stringify(Object.assign(saved, patch)));
  } catch (e) {
    alert("保存到本机失败（可能是头像图片太大）：" + e.message);
  }
  applyProfile();
}

function applyProfile() {
  const p = state.profile;
  const avatarSrc = p.avatarData || p.avatar || "jaydarwin-avatar.jpg";
  $("tc-avatar").src = avatarSrc;
  $("brand-avatar").src = avatarSrc;
  $("profile-avatar-preview").src = avatarSrc;
  $("tc-name-text").textContent = p.name;
  $("tc-handle-text").textContent = "@" + p.handle;
  $("tc-badge").style.display = p.verified ? "" : "none";
  $("brand-eyebrow").textContent = `${p.name} · @${p.handle}`.toUpperCase();
  $("profile-name").value = p.name;
  $("profile-handle").value = p.handle;
  $("badge-on").classList.toggle("active", !!p.verified);
  $("badge-off").classList.toggle("active", !p.verified);
}

/* 导入的推文库：字段宽容，缺什么补什么 */
function normalizePosts(arr) {
  return arr
    .filter((p) => p && typeof p.text === "string" && p.text.trim())
    .map((p, i) => ({
      id: String(p.id || i + 1),
      date: p.date || todayISO(),
      datetime: p.datetime || p.date || "",
      text: p.text,
      long: !!p.long,
      sourceUrl: p.sourceUrl || "",
      topic: p.topic || "未分类",
      metrics: Object.assign({ likes: 0, replies: 0, reposts: 0, bookmarks: 0, views: 0 }, p.metrics || {}),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* ---------- 素材库 ---------- */

function applyFilter() {
  const q = state.search.trim().toLowerCase();
  let list = state.posts;
  if (state.chip.kind === "topic") list = list.filter((p) => p.topic === state.chip.v);
  else if (state.chip.kind === "tag") list = list.filter((p) => (p.tags || []).includes(state.chip.v));
  if (state.month) list = list.filter((p) => p.date.startsWith(state.month));
  if (q) list = list.filter((p) => p.text.toLowerCase().includes(q));
  if (state.sort === "hot") list = [...list].sort((a, b) => b.metrics.likes - a.metrics.likes);
  else if (state.sort === "saved") list = [...list].sort((a, b) => b.metrics.bookmarks - a.metrics.bookmarks);
  state.filtered = list;
  renderList();
}

/* 客观特征标签：从数据确定性推导，任何账号都适用。
   爆款/高收藏按库内分位数（前 10%），样本 ≥20 条才启用。 */
const TAG_DEFS = [
  ["🔥 爆款", (p, ctx) => ctx.likesP90 > 0 && p.metrics.likes >= ctx.likesP90],
  ["⭐ 高收藏", (p, ctx) => ctx.bmP90 > 0 && p.metrics.bookmarks >= ctx.bmP90],
  ["📜 长推", (p) => p.text.length > 300],
  ["📋 清单体", (p) => /(^|\n)\s*(?:[1１][、.．)）]|1️⃣)/.test(p.text)],
  ["❓ 提问式", (p) => /[？?]/.test(p.text.split("\n")[0]) || /[？?]\s*$/.test(p.text)],
  ["💬 金句", (p) => p.text.length <= 60],
];

function computeTags() {
  const withLikes = state.posts.filter((p) => p.metrics && p.metrics.likes > 0);
  const pct = (values, q) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length * q)]; };
  const ctx = {
    likesP90: withLikes.length >= 20 ? pct(withLikes.map((p) => p.metrics.likes), 0.9) : 0,
    bmP90: withLikes.length >= 20 ? pct(withLikes.map((p) => p.metrics.bookmarks), 0.9) : 0,
  };
  state.posts.forEach((p) => {
    p.tags = TAG_DEFS.filter(([, match]) => match(p, ctx)).map(([name]) => name);
  });
}

function renderChips() {
  const wrap = $("topic-chips");
  wrap.innerHTML = "";
  const mk = (label, count, active, onclick) => {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : "");
    b.innerHTML = `${label}<em>${count}</em>`;
    b.onclick = onclick;
    wrap.appendChild(b);
  };
  const pick = (kind, v) => () => { state.chip = { kind, v }; renderChips(); applyFilter(); };
  mk("全部", state.posts.length, state.chip.kind === "all", pick("all", ""));
  const topicCounts = {};
  state.posts.forEach((p) => { if (p.topic && p.topic !== "未分类") topicCounts[p.topic] = (topicCounts[p.topic] || 0) + 1; });
  Object.entries(topicCounts).forEach(([t, n]) => mk(t, n, state.chip.kind === "topic" && state.chip.v === t, pick("topic", t)));
  const tagCounts = {};
  state.posts.forEach((p) => (p.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  TAG_DEFS.forEach(([name]) => { if (tagCounts[name]) mk(name, tagCounts[name], state.chip.kind === "tag" && state.chip.v === name, pick("tag", name)); });
}

function renderMonthOptions() {
  const sel = $("month-filter");
  const months = [...new Set(state.posts.map((p) => p.date.slice(0, 7)))].sort().reverse();
  sel.innerHTML = '<option value="">全部时间</option>' +
    months.map((m) => `<option value="${m}">${Number(m.slice(0, 4))}年${Number(m.slice(5))}月</option>`).join("");
  sel.value = months.includes(state.month) ? state.month : "";
  state.month = sel.value;
}

function refreshLibrary() {
  computeTags();
  renderChips();
  renderMonthOptions();
  applyFilter();
}

function renderList() {
  const ul = $("post-list");
  ul.innerHTML = "";
  state.filtered.slice(0, LIST_CAP).forEach((p) => {
    const li = document.createElement("li");
    li.className = "post-item" + (state.selected && state.selected.id === p.id ? " active" : "");
    const label = p.topic && p.topic !== "未分类" ? p.topic : ((p.tags && p.tags[0]) || "");
    li.innerHTML = `
      <div class="pi-meta"><span>${p.date}${label ? " · " + label : ""}</span><span>❤ ${fmtNum(p.metrics.likes)}</span></div>
      <div class="pi-text"></div>`;
    li.querySelector(".pi-text").textContent = p.text;
    li.onclick = () => selectPost(p);
    ul.appendChild(li);
  });
  if (state.filtered.length > LIST_CAP) {
    const li = document.createElement("li");
    li.className = "list-more";
    li.textContent = `共 ${state.filtered.length} 条，仅显示前 ${LIST_CAP} 条，继续用关键词缩小范围`;
    ul.appendChild(li);
  }
  $("lib-count").textContent = `· ${state.filtered.length}/${state.posts.length} 条`;
}

/* 随机但好看的互动数据：浏览量对数均匀分布，其余按真实比例区间派生 */
function rollMetrics() {
  const r = (min, max) => min + Math.random() * (max - min);
  const views = Math.round(30000 * Math.pow(25, Math.random()) / 100) * 100; // 3万 ~ 75万
  const likes = Math.round(views * r(0.022, 0.045));
  state.fakeMetrics = {
    views,
    likes,
    bookmarks: Math.round(likes * r(0.55, 1.05)),
    reposts: Math.round(likes * r(0.15, 0.32)),
    replies: Math.round(likes * r(0.05, 0.12)),
  };
}

function selectPost(p) {
  state.selected = p;
  rollMetrics();
  renderList();
  renderCard();
}

function randomPost() {
  if (!state.filtered.length) return;
  const p = state.filtered[Math.floor(Math.random() * state.filtered.length)];
  selectPost(p);
  const active = document.querySelector(".post-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

/* ---------- 卡片渲染 ---------- */

const METRIC_ICONS = {
  replies: '<svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg>',
  reposts: '<svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"/></svg>',
  likes: '<svg viewBox="0 0 24 24"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg>',
  bookmarks: '<svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"/></svg>',
  views: '<svg viewBox="0 0 24 24"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"/></svg>',
};

/* 正文渲染：链接 / @提及 / #话题 显示为 X 蓝，与真实推文一致 */
function renderBody(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi, (m) => `<span class="tc-link">${m}</span>`)
    .replace(/(^|[^\w@/])@([A-Za-z0-9_]{2,15})/g, '$1<span class="tc-link">@$2</span>')
    .replace(/(^|[^&\w])#([\p{L}\p{N}_]+)/gu, '$1<span class="tc-link">#$2</span>');
}

function renderCard() {
  const isCustom = state.tab === "custom";
  const text = isCustom ? (state.customText || "写点什么……") : (state.selected ? state.selected.text : "");
  const date = state.dateOverride || (isCustom ? todayISO() : (state.selected ? state.selected.date : todayISO()));

  const body = $("tc-body");
  body.innerHTML = renderBody(text);

  $("tc-date").textContent = fmtDate(date);

  const card = $("tweet-card");
  card.classList.toggle("dark", state.theme === "dark");
  $("width-val").textContent = state.cardWidth + "%";

  // 背景半透明（只透卡片底色，文字不透）
  const alpha = state.cardOpacity / 100;
  card.style.backgroundColor = state.theme === "dark"
    ? `rgba(0, 0, 0, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
  $("opacity-val").textContent = state.cardOpacity + "%";

  const metricsEl = $("tc-metrics");
  const m = state.fakeMetrics;
  if (state.metricsOn && m) {
    metricsEl.classList.remove("hidden");
    metricsEl.innerHTML = ["replies", "reposts", "likes", "bookmarks", "views"]
      .map((k) => `<span>${METRIC_ICONS[k]}<b>${fmtNum(m[k])}</b></span>`).join("");
  } else {
    metricsEl.classList.add("hidden");
  }

  const link = $("source-link");
  if (!isCustom && state.selected && state.selected.sourceUrl) {
    link.style.display = "";
    link.href = state.selected.sourceUrl;
  } else {
    link.style.display = "none";
  }

  const stage = $("stage");
  const isFrame = state.mode !== "card"; // poster(3:4) 或 tall(9:16)
  stage.classList.toggle("card-only", !isFrame);
  stage.classList.toggle("tall", state.mode === "tall");
  $("preview-label").textContent = state.mode === "card" ? "纯卡片 · 透明背景 PNG"
    : state.mode === "tall" ? "9:16 竖图 · 1080×1920" : "3:4 竖图 · 1080×1440";
  $("drag-hint").style.display = isFrame ? "" : "none";

  // 安全区参考线只在竖图模式且开关打开时显示
  $("safe-guides").classList.toggle("hidden", !isFrame || !state.guidesOn);
  $("safe-hatch").classList.toggle("hidden", !isFrame || !state.guidesOn);
  $("stage-dim").style.opacity = isFrame ? state.bgDim / 100 : 0;
  $("dim-option").classList.toggle("hidden", !isFrame);
  renderRail();
  $("live-btn").style.display = isFrame ? "" : "none";

  const promptBox = $("agent-prompt");
  if (promptBox) promptBox.value = buildAgentPrompt();

  // 竖图模式：卡片浮动在安全区里（可拖动）；纯卡片模式贴着画布流式排版
  card.classList.toggle("floating", isFrame);
  layoutCard();
}

/* 安全区几何（预览 px，相对 stage 左上角）。纯卡片模式没有画框，借用 3:4 的宽度当基准 */
function safeBox() {
  const s = SAFE[state.mode === "tall" ? "tall" : "poster"];
  const k = PREVIEW;
  const x0 = s.left * k, x1 = (s.w - s.right) * k;
  const y0 = s.top * k, y1 = (s.h - s.bottom) * k;
  return {
    x0, y0, x1, y1, w: x1 - x0, h: y1 - y0,
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
    stageW: s.w * k, stageH: s.h * k,
  };
}

/* 参考线位置由 SAFE 直接生成，避免 CSS 里再抄一遍数字 */
function syncGuides() {
  const s = SAFE[state.mode === "tall" ? "tall" : "poster"];
  const k = PREVIEW;
  const set = (sel, prop, v) => { const el = document.querySelector(sel); if (el) el.style[prop] = v * k + "px"; };
  set(".sg-top", "top", s.top);
  set(".sg-right", "right", s.right);
  set(".sg-bottom", "bottom", s.bottom);
  set(".sg-left", "left", s.left);
  set(".sg-label-top", "top", s.top + 8);
  set(".sg-label-right", "right", s.right + 8);
  set(".sg-label-bottom", "bottom", s.bottom + 8);
  const lab = document.querySelector(".sg-label-top"), lab2 = document.querySelector(".sg-label-bottom");
  [lab, lab2].forEach((el) => { if (el) el.style.left = (s.left + 8) * k + "px"; });

  // 互动栏在右侧留白带里居中，底边压着底部虚线，正好落在文案区上方
  const rail = $("tt-rail");
  if (rail) {
    rail.style.right = ((s.right - RAIL_W) / 2) * k + "px";
    rail.style.bottom = (s.bottom + 16) * k + "px";
  }
}

/* 互动栏内容：头像和数字都跟卡片走，换一组数据时一起变 */
function renderRail() {
  const rail = $("tt-rail");
  if (!rail) return;
  // 只在 9:16 且开着参考线时出现——它和虚线是同一件事：告诉你抖音会盖住哪里
  const on = state.mode === "tall" && state.guidesOn;
  rail.classList.toggle("hidden", !on);
  // 图标本身就说明了这条带子是干什么的，旁边那个竖排标签就多余了
  const label = document.querySelector(".sg-label-right");
  if (label) label.style.display = on ? "none" : "";
  if (!on) return;

  $("ttr-avatar-img").src = state.profile.avatarData || state.profile.avatar;
  const m = state.fakeMetrics;
  if (m) {
    $("ttr-likes").textContent = fmtNum(m.likes);
    $("ttr-replies").textContent = fmtNum(m.replies);
    $("ttr-bookmarks").textContent = fmtNum(m.bookmarks);
    $("ttr-reposts").textContent = fmtNum(m.reposts);
  }
}

function applyFont(canvasPx) {
  const body = $("tc-body");
  body.style.fontSize = canvasPx * PREVIEW + "px";
  // 字号越小行距越紧，沿用原来 34/30/26/23 四档的手感
  body.style.lineHeight = (1.5 + (canvasPx - 22) * 0.01).toFixed(3);
}

/* 卡片布局。约束按优先级：① 不超出安全区 ② 宽度跟虚线框同宽 ③ 尽量保住用户选的字号。
   收进安全区的手段依次是：先降字号 → 再整卡微缩（下限 RESIDUAL_MIN，避免缩成细条）→ 都不够就放行并警告。
   自动/手动的区别只是字号从哪个值起步，两边都会往下收，所以手动挡不会缩出一条细窄卡片。 */
function layoutCard() {
  const card = $("tweet-card");
  const box = safeBox();
  const isFrame = state.mode !== "card";

  card.style.width = (isFrame ? (box.w * state.cardWidth) / 100 : CARD_ONLY_W * PREVIEW) + "px";
  $("card-width").disabled = !isFrame; // 纯卡片宽度固定，滑杆在这个模式下不参与

  const base = state.fontAuto ? FONT_BASE : state.fontSize;
  let fs = base;
  applyFont(fs);

  // 在 [FONT_MIN, base] 里二分找装得下的最大字号（步长 1 画布 px）
  if (isFrame && card.offsetHeight > box.h) {
    let lo = FONT_MIN, hi = base, best = FONT_MIN;
    for (let i = 0; i < 8 && hi - lo > 1; i++) {
      const mid = Math.round((lo + hi) / 2);
      applyFont(mid);
      if (card.offsetHeight <= box.h) { best = mid; lo = mid; } else hi = mid;
    }
    fs = best;
    applyFont(fs);
  }
  state.fitFont = fs;

  // 字号到下限还超高：整卡微缩兜底。但缩到 RESIDUAL_MIN 以下就成细长条了，
  // 那时改成只保证不被画布裁掉（等于放弃安全区），并把超出量明说
  const need = isFrame ? Math.min(1, box.h / card.offsetHeight) : 1;
  state.fitScale = need >= RESIDUAL_MIN ? need : Math.min(1, (box.stageH * 0.94) / card.offsetHeight);
  const overflowPx = Math.round((card.offsetHeight * state.fitScale - box.h) / PREVIEW);

  const hint = $("fit-hint");
  if (hint) {
    let msg = "";
    if (isFrame && overflowPx > 1) {
      msg = `文字太多：字号已到下限 ${FONT_MIN}px，仍超出安全区 ${overflowPx}px，底部可能被抖音文案栏挡住——建议精简文字，或改用 9:16`;
    } else if (isFrame && state.fitScale < 0.999) {
      msg = `内容偏多，卡片整体缩到 ${Math.round(state.fitScale * 100)}% 才装进安全区`;
    } else if (isFrame && fs < base) {
      msg = state.fontAuto
        ? `内容较长，字号已自动降到 ${fs}px`
        : `${base}px 放不下，已按 ${fs}px 渲染——减少文字才能用上你选的字号`;
    }
    hint.textContent = msg;
    hint.classList.toggle("hidden", !msg);
  }

  $("font-val").textContent = state.fitFont + "px" + (state.fontAuto ? "（自动）" : "");
  $("card-font").value = state.fitFont;
  $("card-width").value = state.cardWidth;
  syncFontButtons();

  applyCardTransform();
}

/* 卡片摆位：以安全区中心为锚点，拖动偏移被夹在安全区内，短内容自然垂直居中，
   长内容缩到刚好等于安全区高度时，居中即等于顶边贴住虚线框左上角 */
function cardPlacement() {
  const card = $("tweet-card");
  const box = safeBox();
  const s = state.fitScale;
  const rw = card.offsetWidth * s, rh = card.offsetHeight * s;
  // 拖动不受安全区约束（出框裁切是有意为之的构图手段），只按画框大小兜底防止拖飞
  const maxDX = box.stageW * 0.55, maxDY = box.stageH * 0.55;
  const dx = clamp(state.cardX * PREVIEW, -maxDX, maxDX);
  const dy = clamp(state.cardY * PREVIEW, -maxDY, maxDY);
  // 锚点：装得进安全区就以安全区中心为准；装不进的极端长文改成对画布居中，
  // 让上下溢出对称，不至于一头被画布裁掉
  const anchorY = rh > box.h ? box.stageH / 2 : box.cy;
  return { s, cx: box.cx + dx, cy: anchorY + dy, rw, rh, maxDX, maxDY };
}

/* 偏移收在画框范围内（画布 px），避免拖出去之后还在累加、往回拖要先补一段空程 */
function clampCardOffset() {
  const { maxDX, maxDY } = cardPlacement();
  state.cardX = clamp(state.cardX, -maxDX / PREVIEW, maxDX / PREVIEW);
  state.cardY = clamp(state.cardY, -maxDY / PREVIEW, maxDY / PREVIEW);
}

function applyCardTransform() {
  const card = $("tweet-card");
  if (state.mode === "card") { card.style.transform = ""; card.style.left = ""; card.style.top = ""; return; }
  const { s, cx, cy } = cardPlacement();
  card.style.left = cx + "px";
  card.style.top = cy + "px";
  card.style.transform = `translate(-50%, -50%) scale(${s.toFixed(4)})`;
}

/* 拖动卡片（仅竖图模式），双击回中 */
function initDrag() {
  const card = $("tweet-card");
  const stage = $("stage");
  let drag = null;
  card.addEventListener("pointerdown", (e) => {
    if (state.mode === "card") return;
    e.preventDefault();
    drag = { x0: e.clientX, y0: e.clientY, baseX: state.cardX, baseY: state.cardY };
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove", (e) => {
    if (!drag) return;
    // 指针位移 → 预览 px（抵消移动端 zoom）→ 画布 px；越界由 cardPlacement 统一夹在安全区内
    const z = Number(stage.style.zoom || 1) || 1;
    const k = z * PREVIEW;
    state.cardX = drag.baseX + (e.clientX - drag.x0) / k;
    state.cardY = drag.baseY + (e.clientY - drag.y0) / k;
    clampCardOffset();
    applyCardTransform();
  });
  const end = () => { drag = null; card.classList.remove("dragging"); };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
  card.addEventListener("dblclick", () => { state.cardX = 0; state.cardY = 0; applyCardTransform(); });
}

/* ---------- 背景 ---------- */

function openBackgroundDb() {
  if (!backgroundDbPromise) {
    backgroundDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(BG_DB_NAME, BG_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BG_DB_STORE)) db.createObjectStore(BG_DB_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开本地背景库"));
    });
  }
  return backgroundDbPromise;
}

function finishTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("保存本地背景失败"));
    tx.onabort = () => reject(tx.error || new Error("保存本地背景已中止"));
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("读取本地背景失败"));
  });
}

function localBackgroundId(file) {
  return file.webkitRelativePath || file.name;
}

function isImageFile(file) {
  return (file.type && file.type.startsWith("image/")) || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name);
}

function backgroundKey(item) {
  return item.source === "local" ? `local:${item.id}` : `builtin:${item.file}`;
}

function backgroundSrc(item) {
  return item.source === "local" ? item.url : `backgrounds/${item.file}`;
}

function setBackgroundStatus(message, tone = "") {
  const status = $("bg-folder-status");
  status.textContent = message;
  status.classList.toggle("success", tone === "success");
  status.classList.toggle("error", tone === "error");
}

async function readLocalBackgrounds() {
  const db = await openBackgroundDb();
  const records = await getAllFromStore(db.transaction(BG_DB_STORE, "readonly").objectStore(BG_DB_STORE));
  return records
    .sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0) || a.path.localeCompare(b.path, "zh-CN"))
    .map((record) => ({
      id: record.id,
      source: "local",
      name: record.name,
      path: record.path,
      file: record.path,
      url: URL.createObjectURL(record.blob),
    }));
}

function revokeLocalBackgroundUrls(items = state.backgrounds) {
  items.filter((item) => item.source === "local" && item.url).forEach((item) => URL.revokeObjectURL(item.url));
}

async function refreshLocalBackgrounds() {
  const builtins = state.backgrounds.filter((item) => item.source !== "local");
  const oldLocals = state.backgrounds.filter((item) => item.source === "local");
  const locals = await readLocalBackgrounds();
  revokeLocalBackgroundUrls(oldLocals);
  state.backgrounds = [...locals, ...builtins];
  if (state.bgKey && state.bgKey.startsWith("local:")) {
    const selected = locals.find((item) => backgroundKey(item) === state.bgKey);
    if (selected) {
      state.bg = backgroundSrc(selected);
      $("stage-bg").src = state.bg;
    } else {
      state.bg = null;
      state.bgKey = null;
    }
  }
  return locals;
}

async function importBackgroundFolder(fileList) {
  const files = Array.from(fileList || []).filter(isImageFile);
  if (!files.length) {
    setBackgroundStatus("这个文件夹里没有可读取的图片。", "error");
    return;
  }

  const label = $("bg-folder-label");
  label.classList.add("is-loading");
  setBackgroundStatus(`正在保存 ${files.length} 张图片…`);
  try {
    const existingIds = new Set(state.backgrounds.filter((item) => item.source === "local").map((item) => item.id));
    const importedAt = Date.now();
    const db = await openBackgroundDb();
    const tx = db.transaction(BG_DB_STORE, "readwrite");
    const store = tx.objectStore(BG_DB_STORE);
    files.forEach((file, index) => {
      const path = file.webkitRelativePath || file.name;
      store.put({
        id: localBackgroundId(file),
        name: file.name.replace(/\.[^.]+$/, ""),
        path,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        importedAt: importedAt + index,
        blob: file,
      });
    });
    await finishTransaction(tx);
    const importedIds = new Set(files.map(localBackgroundId));
    const locals = await refreshLocalBackgrounds();
    const first = locals.find((item) => importedIds.has(item.id));
    if (first) {
      state.bg = backgroundSrc(first);
      state.bgKey = backgroundKey(first);
      $("stage-bg").src = state.bg;
    }
    state.bgQuery = "";
    state.bgLimit = Math.max(15, Math.min(locals.length, 60));
    $("bg-search").value = "";
    renderBackgroundGrid();
    const newCount = files.filter((file) => !existingIds.has(localBackgroundId(file))).length;
    const updatedCount = files.length - newCount;
    const detail = updatedCount ? `，更新 ${updatedCount} 张重复图片` : "";
    setBackgroundStatus(`已导入 ${newCount} 张新背景${detail}，共保存 ${locals.length} 张本地背景。`, "success");
  } catch (error) {
    console.error(error);
    setBackgroundStatus("导入失败，浏览器存储空间可能不足。可减少图片数量后重试。", "error");
  } finally {
    label.classList.remove("is-loading");
    $("bg-folder-upload").value = "";
  }
}

async function clearLocalBackgrounds() {
  const localCount = state.backgrounds.filter((item) => item.source === "local").length;
  if (!localCount || !confirm(`从网页图库中移除 ${localCount} 张批量背景？原文件夹里的图片不会被删除。`)) return;
  try {
    const db = await openBackgroundDb();
    const tx = db.transaction(BG_DB_STORE, "readwrite");
    tx.objectStore(BG_DB_STORE).clear();
    await finishTransaction(tx);
    await refreshLocalBackgrounds();
    renderBackgroundGrid();
    setBackgroundStatus("已清空批量背景，原文件夹中的图片没有被删除。", "success");
  } catch (error) {
    console.error(error);
    setBackgroundStatus("清空失败，请刷新页面后重试。", "error");
  }
}

function renderBackgroundGrid() {
  const grid = $("bg-grid");
  const query = state.bgQuery.trim().toLowerCase();
  const matches = state.backgrounds.filter((item) => !query || `${item.name} ${item.path || ""} ${item.file || ""}`.toLowerCase().includes(query));
  const visible = matches.slice(0, state.bgLimit);
  grid.innerHTML = "";
  visible.forEach((item, i) => {
    const src = backgroundSrc(item);
    const key = backgroundKey(item);
    const btn = document.createElement("button");
    btn.className = "bg-thumb";
    btn.title = item.path || item.name;
    btn.dataset.bgKey = key;
    const img = document.createElement("img");
    img.src = src;
    img.alt = item.name;
    img.loading = "lazy";
    img.decoding = "async";
    const name = document.createElement("span");
    name.className = "bg-name";
    name.textContent = item.source === "local" ? `本地 · ${item.name}` : item.name;
    btn.append(img, name);
    btn.onclick = () => setBg(src, btn, key);
    grid.appendChild(btn);
    // 已由 URL 参数指定背景时不要覆盖
    if (state.bgKey === key || (!state.bgKey && state.bg === src)) btn.classList.add("active");
    else if (i === 0 && !state.bg) setBg(src, btn, key);
  });
  const localCount = state.backgrounds.filter((item) => item.source === "local").length;
  $("bg-count").textContent = `当前显示 ${visible.length} / ${matches.length} 张 · 本地 ${localCount} 张`;
  $("bg-more").classList.toggle("hidden", visible.length >= matches.length);
  $("bg-more").textContent = `查看更多背景（还有 ${Math.max(0, matches.length - visible.length)} 张）`;
  $("bg-folder-clear").classList.toggle("hidden", localCount === 0);
}

function setBg(src, thumbEl, key = null) {
  state.bg = src;
  state.bgKey = key;
  $("stage-bg").src = src;
  document.querySelectorAll(".bg-thumb").forEach((b) => b.classList.remove("active"));
  if (thumbEl) thumbEl.classList.add("active");
}

function addCustomThumb(dataUrl) {
  const grid = $("bg-grid");
  const btn = document.createElement("button");
  btn.className = "bg-thumb";
  btn.innerHTML = `<img src="${dataUrl}" alt="自定义背景" /><span class="bg-name">自定义</span>`;
  btn.onclick = () => setBg(dataUrl, btn, null);
  grid.appendChild(btn);
  setBg(dataUrl, btn);
}

/* ---------- 移动端适配与成品交付 ---------- */

/* stage 用 zoom 等比缩放适配窄屏：zoom 改变布局尺寸（不像 transform 会残留 540px 布局导致溢出错位）。导出前会临时还原。 */
function fitStageScale() {
  const wrap = document.querySelector(".stage-wrap");
  const stage = $("stage");
  stage.style.zoom = Math.min(1, (wrap.clientWidth - 24) / 540);
}

function isMobileLike() {
  return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/* 桌面直接下载；移动端弹预览面板走系统分享（按钮点击是新的用户手势，不会像异步 a.click 那样被 iOS 拦截） */
function deliverFile(blob, filename, hint) {
  if (isMobileLike()) { showExportSheet(blob, filename, hint); return; }
  const a = document.createElement("a");
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function showExportSheet(blob, filename, hint) {
  const url = URL.createObjectURL(blob);
  const isVideo = blob.type.startsWith("video/");
  const sheet = document.createElement("div");
  sheet.className = "export-sheet";
  sheet.innerHTML = `
    <div class="es-panel">
      <div class="es-preview">${isVideo ? `<video src="${url}" autoplay muted loop playsinline></video>` : `<img src="${url}" alt="导出结果" />`}</div>
      <p class="es-hint">${hint}</p>
      <div class="es-actions">
        <button class="primary-btn es-share">保存 / 分享</button>
        <button class="ghost-btn es-close">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  sheet.querySelector(".es-share").onclick = async () => {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch { /* 用户取消 */ }
    } else {
      const a = document.createElement("a");
      a.download = filename; a.href = url; a.click();
    }
  };
  sheet.querySelector(".es-close").onclick = () => { sheet.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
}

/* ---------- 导出 ---------- */

/* 卡片单独光栅化：临时摘掉浮动定位与 transform（作为根节点捕获时这些样式会被克隆进画布导致位移裁切） */
async function captureCardCanvas(pixelRatio) {
  const card = $("tweet-card");
  const hadFloating = card.classList.contains("floating");
  const prev = { transform: card.style.transform, left: card.style.left, top: card.style.top };
  card.classList.remove("floating");
  // 摘掉 floating 后 position 回到 relative，残留的 left/top 会把卡片推偏，一并清掉
  card.style.transform = "none";
  card.style.left = "";
  card.style.top = "";
  try {
    return await htmlToImage.toCanvas(card, { pixelRatio });
  } finally {
    if (hadFloating) card.classList.add("floating");
    Object.assign(card.style, prev);
  }
}

/* 竖图成品：canvas 手动合成——背景直接 drawImage，不经 foreignObject
   （iOS Safari 对 foreignObject 里的 <img> 渲染不可靠，会导致背景整片变黑）。与 Live 视频同一条管线。 */
async function composePoster() {
  const stage = $("stage");
  const prevZoom = stage.style.zoom;
  stage.style.zoom = "1"; // 还原 1:1 布局再测量与捕获，避免移动端缩放影响尺寸计算
  try {
    const SP = SAFE[state.mode === "tall" ? "tall" : "poster"];
    const W = SP.w, H = SP.h;
    const cardCanvas = await captureCardCanvas(2);
    // 预览 px → 画布 px：全部走 cardPlacement，保证预览所见即导出所得
    const { rw, rh, cx: pcx, cy: pcy } = cardPlacement();
    const cw = rw / PREVIEW, ch = rh / PREVIEW;
    const cx = pcx / PREVIEW, cy = pcy / PREVIEW;
    const bg = new Image();
    await new Promise((res, rej) => { bg.onload = res; bg.onerror = rej; bg.src = state.bg; });
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    drawCover(ctx, bg, W, H, 1);
    if (state.bgDim > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${state.bgDim / 100})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(cardCanvas, cx - cw / 2, cy - ch / 2, cw, ch);
    ctx.restore();
    return cv;
  } finally {
    stage.style.zoom = prevZoom;
  }
}

async function exportPng() {
  const btn = $("export-btn");
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    let blob;
    if (state.mode === "card") {
      // 纯卡片：透明背景，直接光栅化卡片
      const cardCanvas = await captureCardCanvas(3);
      blob = await new Promise((res) => cardCanvas.toBlob(res, "image/png"));
    } else {
      const cv = await composePoster();
      blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    }
    const tag = state.tab === "custom" ? "custom" : (state.selected ? state.selected.id : "empty");
    const name = `${state.profile.handle}-card-${(state.selected && state.tab !== "custom" ? state.selected.date : todayISO()).replaceAll("-", "")}-${tag}.png`;
    deliverFile(blob, name, "点「保存 / 分享」存到相册，或长按图片保存");
  } catch (err) {
    alert("导出失败：" + err.message + "\n如果用了网络图片背景，可能是跨域限制，请下载后用「上传图片」。");
  } finally {
    btn.disabled = false;
    btn.textContent = "下载 PNG";
  }
}

/* ---------- BYOK：用用户自己的 X API Key 同步推文 ----------
   Key 只存 localStorage；浏览器无法直连 api.x.com（无 CORS 头），
   请求经 tools.upthos.com 的无状态转发（Pages Function，不记录不存储）。 */

const X_PROXY = "https://tools.upthos.com/api/x/";
const XKEY_KEY = "tcs-xkey";
const XSYNC_KEY = "tcs-xsync"; // { handle, newestId }

async function xApi(path, params, token) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(X_PROXY + path + (qs ? "?" + qs : ""), {
    headers: { Authorization: "Bearer " + token },
  });
  if (r.status === 401) throw new Error("Key 无效或无权限（401）");
  if (r.status === 403) throw new Error("你的套餐无此端点权限（403）");
  if (r.status === 429) throw new Error("RATE_LIMIT");
  if (!r.ok) throw new Error("X API 错误 " + r.status);
  return r.json();
}

/* 清洗 API 返回：长推取全文，t.co 换成可读链接，媒体链接删除（与 build_posts.py 同逻辑） */
function cleanApiText(p) {
  const note = p.note_tweet || {};
  let text = note.text || p.text || "";
  const urls = [...((p.entities || {}).urls || []), ...((note.entities || {}).urls || [])];
  for (const u of urls) {
    if (!u.url) continue;
    const expanded = u.expanded_url || "", display = u.display_url || "";
    if (expanded.includes("/photo/") || expanded.includes("/video/") || display.startsWith("pic.x.com") || display.startsWith("pic.twitter.com")) {
      text = text.replaceAll(u.url, "");
    } else {
      text = text.replaceAll(u.url, display);
    }
  }
  text = text.replace(/https:\/\/t\.co\/\w+/g, "");
  return text.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
}

function apiToPost(p, handle) {
  const d = new Date(p.created_at);
  const pm = p.public_metrics || {};
  return {
    id: p.id,
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    datetime: "",
    text: cleanApiText(p),
    long: !!p.note_tweet,
    sourceUrl: `https://x.com/${handle}/status/${p.id}`,
    topic: "未分类",
    metrics: {
      likes: pm.like_count || 0,
      replies: pm.reply_count || 0,
      reposts: (pm.retweet_count || 0) + (pm.quote_count || 0),
      bookmarks: pm.bookmark_count || 0,
      views: pm.impression_count || 0,
    },
  };
}

async function xSync() {
  const btn = $("x-sync"), status = $("x-status");
  const token = $("x-token").value.trim();
  const handle = $("x-handle").value.trim().replace(/^@+/, "");
  const limit = Number($("x-limit").value);
  if (!token) { status.textContent = "请先填 Bearer Token"; return; }
  if (!token.startsWith("AA") || token.length < 60) {
    status.textContent = "这不像 Bearer Token（应为 AAAA 开头的 100+ 位长字符串）。API Key / Secret 不能用，请到 Keys and tokens 页复制 Bearer Token";
    return;
  }
  if (!handle) { status.textContent = "请填用户名"; return; }

  btn.disabled = true;
  const collected = [];
  try {
    localStorage.setItem(XKEY_KEY, token);

    status.textContent = "查询用户…";
    const ur = await xApi("2/users/by/username/" + handle, { "user.fields": "profile_image_url,verified,verified_type" }, token);
    if (!ur.data) throw new Error("找不到用户 @" + handle);
    const user = ur.data;

    let sync = null;
    try { sync = JSON.parse(localStorage.getItem(XSYNC_KEY) || "null"); } catch { /* 忽略 */ }
    const incremental = sync && sync.handle === handle && sync.newestId;

    const base = {
      max_results: "100",
      exclude: "replies,retweets",
      "tweet.fields": "created_at,public_metrics,note_tweet,entities",
    };
    if (incremental) base.since_id = sync.newestId;

    let nextToken = null, rateLimited = false;
    while (collected.length < limit) {
      status.textContent = `拉取中… 已 ${collected.length} 条`;
      const params = { ...base };
      if (nextToken) params.pagination_token = nextToken;
      let page;
      try {
        page = await xApi(`2/users/${user.id}/tweets`, params, token);
      } catch (e) {
        if (e.message === "RATE_LIMIT" && collected.length) { rateLimited = true; break; }
        throw e;
      }
      (page.data || []).forEach((p) => collected.push(apiToPost(p, handle)));
      nextToken = page.meta && page.meta.next_token;
      if (!nextToken) break;
    }

    const merged = new Map();
    if (incremental) state.posts.forEach((p) => merged.set(p.id, p));
    collected.forEach((p) => { if (p.text) merged.set(p.id, p); });
    if (!merged.size) throw new Error(incremental ? "没有新推文" : "没拉到任何推文");
    state.posts = [...merged.values()].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

    localStorage.setItem(XSYNC_KEY, JSON.stringify({ handle, newestId: state.posts[0].id }));
    try {
      localStorage.setItem(POSTS_KEY, JSON.stringify(state.posts));
      localStorage.setItem(POSTS_BUNDLE_VERSION_KEY, POSTS_BUNDLE_VERSION);
    }
    catch { alert("推文库太大无法保存到本机，仅本次会话有效。可让 Claude 把它写入 posts.json 持久化。"); }

    saveProfileOverride({ name: user.name, handle: user.username, verified: !!(user.verified || user.verified_type === "blue") });
    try {
      const av = await fetch(user.profile_image_url.replace("_normal", "_400x400"));
      if (av.ok) {
        const blob = await av.blob();
        const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        saveProfileOverride({ avatarData: dataUrl });
      }
    } catch { /* 头像拉不到就让用户手动传 */ }

    state.chip = { kind: "all", v: "" };
    state.month = "";
    refreshLibrary();
    $("tab-library").click();
    selectPost(state.posts[0]);
    status.textContent = rateLimited
      ? `已同步 ${collected.length} 条后触发频控，15 分钟后可再拉`
      : `完成：新增 ${collected.length} 条，库内共 ${state.posts.length} 条`;
  } catch (err) {
    status.textContent = err.message === "RATE_LIMIT" ? "触发 X API 频控（429），请 15 分钟后再试" : "失败：" + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 导出 Live 图（3 秒动效 MP4，WebCodecs 编码） ----------
   卡片完全静止，只有背景缓慢推近（Ken Burns）。
   手机端用 intoLive / 快捷指令把 MP4 转成实况照片后即可按 Live 图发布。 */

function drawCover(ctx, img, W, H, zoom) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const ir = iw / ih, r = W / H;
  let dw, dh;
  if (ir > r) { dh = H * zoom; dw = dh * ir; } else { dw = W * zoom; dh = dw / ir; }
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

async function exportLive() {
  if (state.mode === "card") return;
  if (!("VideoEncoder" in window)) {
    alert("当前浏览器不支持视频编码（WebCodecs）。请使用新版 Chrome / Edge / Safari。");
    return;
  }
  const btn = $("live-btn");
  btn.disabled = true;
  try {
    const SP = SAFE[state.mode === "tall" ? "tall" : "poster"];
    const W = SP.w, H = SP.h;
    const FPS = 30, DUR = 3, TOTAL = FPS * DUR;

    const codec = { codec: "avc1.640028", width: W, height: H, bitrate: 8_000_000, framerate: FPS };
    const support = await VideoEncoder.isConfigSupported(codec);
    if (!support.supported) throw new Error("此设备不支持 H.264 1080p 编码");

    // 卡片只光栅化一次，逐帧只做画布合成
    btn.textContent = "准备卡片…";
    const cardCanvas = await captureCardCanvas(2);
    const { rw, rh, cx: pcx, cy: pcy } = cardPlacement();
    const cw = rw / PREVIEW, ch = rh / PREVIEW;
    const cx = pcx / PREVIEW, cy = pcy / PREVIEW;

    const bg = new Image();
    await new Promise((res, rej) => { bg.onload = res; bg.onerror = rej; bg.src = state.bg; });

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: W, height: H },
      fastStart: "in-memory",
    });
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error(e),
    });
    encoder.configure(codec);

    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");

    for (let f = 0; f < TOTAL; f++) {
      const t = f / (TOTAL - 1);
      drawCover(ctx, bg, W, H, 1 + 0.07 * t); // 只动背景：缓慢推近
      if (state.bgDim > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${state.bgDim / 100})`;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 10;
      ctx.drawImage(cardCanvas, cx - cw / 2, cy - ch / 2, cw, ch); // 卡片完全静止
      ctx.restore();
      const frame = new VideoFrame(cv, { timestamp: (f * 1e6) / FPS, duration: 1e6 / FPS });
      encoder.encode(frame, { keyFrame: f % FPS === 0 });
      frame.close();
      if (f % 6 === 0) {
        btn.textContent = `渲染 ${Math.round((f / TOTAL) * 100)}%`;
        await new Promise((r) => setTimeout(r));
      }
    }
    btn.textContent = "编码中…";
    await encoder.flush();
    muxer.finalize();

    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const tag = state.tab === "custom" ? "custom" : (state.selected ? state.selected.id : "empty");
    const name = `${state.profile.handle}-live-${todayISO().replaceAll("-", "")}-${tag}.mp4`;
    deliverFile(blob, name, "保存到相册后，用 intoLive / 快捷指令转成实况照片再发布");

    if (!isMobileLike() && !localStorage.getItem("tcs-live-hint")) {
      localStorage.setItem("tcs-live-hint", "1");
      alert("已导出 3 秒动效 MP4。\n\n发布为 Live 图：把视频传到手机，用 intoLive（免费 App）或快捷指令转成实况照片，抖音/小红书发布时从相册选择即可带「实况」标识。");
    }
  } catch (err) {
    alert("Live 图导出失败：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "导出 Live 图";
  }
}

/* ---------- 事件绑定 ---------- */

/* URL 参数改了 state 之后，左侧那几组按钮得跟着亮，否则会出现
   预览是 9:16、按钮却停在 3:4 这种对不上的状态 */
function syncControls() {
  const pick = (pairs) => pairs.forEach(([id, on]) => $(id).classList.toggle("active", on));
  pick([["mode-poster", state.mode === "poster"], ["mode-tall", state.mode === "tall"], ["mode-card", state.mode === "card"]]);
  pick([["theme-light", state.theme === "light"], ["theme-dark", state.theme === "dark"]]);
  pick([["metrics-on", state.metricsOn], ["metrics-off", !state.metricsOn]]);
  pick([["guides-on", state.guidesOn], ["guides-off", !state.guidesOn]]);
  $("card-opacity").value = state.cardOpacity;
  $("bg-dim").value = state.bgDim;
  $("dim-val").textContent = state.bgDim + "%";
  document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
}

function updateRangeFill(input) {
  const min = Number(input.min || 0), max = Number(input.max || 100), value = Number(input.value);
  input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

/* 拖字号滑杆等于切到手动，按钮状态跟着走 */
function syncFontButtons() {
  $("font-auto").classList.toggle("active", state.fontAuto);
  $("font-manual").classList.toggle("active", !state.fontAuto);
  $("card-font").disabled = false;
}

function bindSegmented(pairs, onChange) {
  // pairs: [[element, value], ...]
  pairs.forEach(([el, value]) => {
    el.onclick = () => {
      pairs.forEach(([e]) => e.classList.remove("active"));
      el.classList.add("active");
      onChange(value);
    };
  });
}

function bind() {
  bindSegmented([[$("tab-library"), "library"], [$("tab-custom"), "custom"]], (v) => {
    state.tab = v;
    $("library-section").classList.toggle("hidden", v !== "library");
    $("custom-section").classList.toggle("hidden", v !== "custom");
    renderCard();
  });

  bindSegmented([[$("mode-poster"), "poster"], [$("mode-tall"), "tall"], [$("mode-card"), "card"]], (v) => { state.mode = v; syncGuides(); renderCard(); });
  bindSegmented([[$("font-auto"), true], [$("font-manual"), false]], (v) => {
    state.fontAuto = v;
    if (!v) state.fontSize = state.fitFont; // 切手动时从当前自动值接上，不跳变
    layoutCard();
  });
  bindSegmented([[$("theme-light"), "light"], [$("theme-dark"), "dark"]], (v) => { state.theme = v; renderCard(); });
  bindSegmented([[$("metrics-on"), true], [$("metrics-off"), false]], (v) => { state.metricsOn = v; renderCard(); });
  bindSegmented([[$("guides-on"), true], [$("guides-off"), false]], (v) => { state.guidesOn = v; renderCard(); });

  document.querySelectorAll(".sort-chip").forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll(".sort-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.sort = chip.dataset.sort;
      applyFilter();
    };
  });

  $("search").oninput = (e) => { state.search = e.target.value; applyFilter(); };
  $("month-filter").onchange = (e) => { state.month = e.target.value; applyFilter(); };
  $("random-btn").onclick = randomPost;
  $("custom-text").oninput = (e) => { state.customText = e.target.value; renderCard(); };
  $("custom-reseed").onclick = () => {
    state.customText = state.selected ? state.selected.text : "";
    $("custom-text").value = state.customText;
    renderCard();
  };
  $("card-width").oninput = (e) => {
    state.cardWidth = Number(e.target.value);
    $("width-val").textContent = state.cardWidth + "%";
    updateRangeFill(e.target);
    layoutCard();
  };
  $("card-font").oninput = (e) => {
    state.fontAuto = false;
    state.fontSize = Number(e.target.value);
    syncFontButtons();
    updateRangeFill(e.target);
    layoutCard();
  };
  $("card-opacity").oninput = (e) => { state.cardOpacity = Number(e.target.value); updateRangeFill(e.target); renderCard(); };
  $("bg-dim").oninput = (e) => { state.bgDim = Number(e.target.value); updateRangeFill(e.target); renderCard(); };

  $("bg-search").oninput = (e) => { state.bgQuery = e.target.value; state.bgLimit = 15; renderBackgroundGrid(); };
  $("bg-more").onclick = () => { state.bgLimit += 15; renderBackgroundGrid(); };

  $("bg-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addCustomThumb(reader.result);
    reader.readAsDataURL(file);
  };

  $("bg-folder-upload").onchange = (e) => importBackgroundFolder(e.target.files);
  $("bg-folder-clear").onclick = clearLocalBackgrounds;

  $("bg-url").onkeydown = async (e) => {
    if (e.key !== "Enter") return;
    const url = e.target.value.trim();
    if (!url) return;
    try {
      const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      const reader = new FileReader();
      reader.onload = () => addCustomThumb(reader.result);
      reader.readAsDataURL(blob);
    } catch {
      alert("拉取失败（多半是跨域限制）。请把图片下载到本地后用「上传图片」。");
    }
  };

  $("copy-text").onclick = async () => {
    const text = state.tab === "custom" ? state.customText : (state.selected ? state.selected.text : "");
    await navigator.clipboard.writeText(text);
    $("copy-text").textContent = "已复制 ✓";
    setTimeout(() => ($("copy-text").textContent = "复制文案"), 1200);
  };

  $("shuffle-metrics").onclick = () => { rollMetrics(); renderCard(); };

  $("copy-link").onclick = async () => {
    await navigator.clipboard.writeText(buildShareUrl(false));
    $("copy-link").textContent = "已复制 ✓";
    setTimeout(() => ($("copy-link").textContent = "复制链接"), 1200);
  };

  $("copy-agent").onclick = async () => {
    await navigator.clipboard.writeText($("agent-prompt").value);
    $("copy-agent").textContent = "已复制 ✓";
    setTimeout(() => ($("copy-agent").textContent = "复制这段指令"), 1400);
  };

  $("export-btn").onclick = exportPng;
  $("live-btn").onclick = exportLive;

  /* ---- 账号信息 ---- */
  $("profile-name").oninput = (e) => { saveProfileOverride({ name: e.target.value || DEFAULT_PROFILE.name }); renderCard(); };
  $("profile-handle").oninput = (e) => { saveProfileOverride({ handle: e.target.value.replace(/^@+/, "") || DEFAULT_PROFILE.handle }); renderCard(); };
  $("badge-on").onclick = () => saveProfileOverride({ verified: true });
  $("badge-off").onclick = () => saveProfileOverride({ verified: false });

  $("avatar-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => saveProfileOverride({ avatarData: reader.result });
    reader.readAsDataURL(file);
  };

  $("posts-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw new Error("需要一个 JSON 数组");
        const posts = normalizePosts(arr);
        if (!posts.length) throw new Error("没有找到带 text 字段的条目");
        state.posts = posts;
        try {
          localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
          localStorage.setItem(POSTS_BUNDLE_VERSION_KEY, POSTS_BUNDLE_VERSION);
        }
        catch { alert("推文库太大，无法保存到本机，仅本次会话有效。想永久使用请把文件存为项目里的 posts.json"); }
        state.chip = { kind: "all", v: "" };
        state.month = "";
        refreshLibrary();
        selectPost(state.posts[0]);
      } catch (err) {
        alert("导入失败：" + err.message + "\n格式见 README：[{\"date\":\"2026-01-01\",\"text\":\"...\"}]");
      }
    };
    reader.readAsText(file);
  };

  $("posts-export").onclick = () => {
    const blob = new Blob([JSON.stringify(state.posts, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tweet-card-library-${todayISO()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  $("profile-reset").onclick = () => {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(POSTS_KEY);
    localStorage.removeItem(POSTS_BUNDLE_VERSION_KEY);
    localStorage.removeItem(XSYNC_KEY);
    location.reload();
  };

  /* ---- X API 同步（BYOK） ---- */
  $("x-token").value = localStorage.getItem(XKEY_KEY) || "";
  if (state.profile.handle) $("x-handle").value = state.profile.handle;
  $("x-sync").onclick = xSync;
  $("x-clear").onclick = () => {
    localStorage.removeItem(XKEY_KEY);
    $("x-token").value = "";
    $("x-status").textContent = "已清除本机保存的 Key";
  };
}

/* ---------- 启动 ---------- */

async function loadPosts() {
  // 优先级：本机导入的库 → posts.json → posts.sample.json（示例数据）
  try {
    const savedVersion = localStorage.getItem(POSTS_BUNDLE_VERSION_KEY);
    const saved = JSON.parse(localStorage.getItem(POSTS_KEY) || "null");
    if (savedVersion === POSTS_BUNDLE_VERSION && Array.isArray(saved) && saved.length) return saved;
    if (savedVersion !== POSTS_BUNDLE_VERSION) localStorage.removeItem(POSTS_KEY);
  } catch { /* 忽略损坏的本机数据 */ }
  for (const src of ["posts.json", "posts.sample.json"]) {
    try {
      const r = await fetch(src + "?v=" + POSTS_BUNDLE_VERSION);
      if (r.ok) {
        const posts = normalizePosts(await r.json());
        localStorage.setItem(POSTS_BUNDLE_VERSION_KEY, POSTS_BUNDLE_VERSION);
        return posts;
      }
    } catch { /* 继续尝试下一个来源 */ }
  }
  return [];
}

/* ---------- URL 参数 / Agent 接口 ----------
   任何带浏览器能力的 Agent 都可以：打开 ?embed=1&text=...，等待
   document.documentElement.dataset.ready === "1"，再读 window.__cardDataUrl。 */

const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

function blobToDataUrl(blob) {
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
}

/* 外部图片先取回转 dataURL，避免 canvas 被跨域污染导致导出失败 */
async function fetchAsDataUrl(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await blobToDataUrl(await r.blob());
  } catch { return null; }
}

async function resolveBgParam(v) {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) {
    const src = await fetchAsDataUrl(v);
    return src ? { src, key: null } : null;
  }
  const hit = state.backgrounds.find((b) =>
    backgroundKey(b) === v ||
    b.file === v ||
    (b.file && b.file.replace(/\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i, "") === v) ||
    b.name === v
  );
  return hit ? { src: backgroundSrc(hit), key: backgroundKey(hit) } : null;
}

async function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return false;

  if (q.get("name")) state.profile.name = q.get("name");
  if (q.get("handle")) state.profile.handle = q.get("handle").replace(/^@+/, "");
  if (q.has("verified")) state.profile.verified = q.get("verified") !== "0";
  if (q.get("avatar")) {
    const data = await fetchAsDataUrl(q.get("avatar"));
    if (data) state.profile.avatarData = data;
  }
  applyProfile();

  if (q.get("text")) { state.tab = "custom"; state.customText = q.get("text"); }
  if (q.get("date")) state.dateOverride = q.get("date");

  const mode = q.get("mode");
  if (["poster", "tall", "card"].includes(mode)) state.mode = mode;
  if (q.get("theme") === "dark") state.theme = "dark";
  // width：卡片宽度占安全区宽度的百分比。scale 是旧参数名（原义是占画布的缩放），
  // 语义已变，这里只当别名收下并按新范围夹紧，老链接不至于失效
  if (q.has("width")) state.cardWidth = clampNum(q.get("width"), 50, 100, state.cardWidth);
  else if (q.has("scale")) state.cardWidth = clampNum(q.get("scale"), 50, 100, state.cardWidth);
  if (q.has("font")) {
    const v = q.get("font");
    if (v === "auto") state.fontAuto = true;
    else { state.fontAuto = false; state.fontSize = clampNum(v, FONT_MIN, FONT_MAX, FONT_BASE); }
  }
  if (q.has("opacity")) state.cardOpacity = clampNum(q.get("opacity"), 30, 100, state.cardOpacity);
  if (q.has("dim")) state.bgDim = clampNum(q.get("dim"), 0, 55, state.bgDim);
  if (q.has("x")) state.cardX = clampNum(q.get("x"), -600, 600, 0);
  if (q.has("y")) state.cardY = clampNum(q.get("y"), -900, 900, 0);
  if (q.get("guides") === "0") state.guidesOn = false;

  if (q.get("metrics") === "off") state.metricsOn = false;
  const MET = ["likes", "reposts", "replies", "bookmarks", "views"];
  if (MET.some((k) => q.has(k))) {
    MET.forEach((k) => { if (q.has(k)) state.fakeMetrics[k] = clampNum(q.get(k), 0, 1e9, state.fakeMetrics[k]); });
  }

  const bg = await resolveBgParam(q.get("bg"));
  if (bg) { state.bg = bg.src; state.bgKey = bg.key; $("stage-bg").src = bg.src; }

  return q.get("embed") === "1";
}

/* embed 模式：隐藏界面，只输出成品，把 base64 PNG 挂到 window.__cardDataUrl */
async function runEmbed() {
  document.body.style.opacity = "0"; // 保留布局（卡片才有尺寸可捕获）
  try {
    await document.fonts.ready.catch(() => {});
    renderCard();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = state.mode === "card" ? await captureCardCanvas(3) : await composePoster();
    const dataUrl = cv.toDataURL("image/png");
    window.__cardDataUrl = dataUrl;
    window.__cardSize = { width: cv.width, height: cv.height };

    document.body.classList.add("embed");
    document.body.style.opacity = "";
    const view = document.createElement("div");
    view.id = "embed-view";
    view.innerHTML = '<img id="embed-img" alt="tweet card" />';
    document.body.appendChild(view);
    $("embed-img").src = dataUrl;
    document.documentElement.dataset.ready = "1";
  } catch (err) {
    document.body.style.opacity = "";
    window.__cardError = String(err && err.message ? err.message : err);
    document.documentElement.dataset.ready = "error";
  }
}

/* 生成一段可以整个发给 AI Agent 的指令 */
function buildAgentPrompt() {
  return [
    "帮我用这个网页工具生成一张推文卡片图片，步骤：",
    "",
    "1. 用浏览器打开下面这个链接（已包含我调好的全部样式）：",
    buildShareUrl(true),
    "",
    '2. 等待页面上 document.documentElement.dataset.ready 变成 "1"',
    '   （如果变成 "error"，失败原因在 window.__cardError）',
    "",
    "3. 读取 window.__cardDataUrl，它是 data:image/png;base64,... 格式，",
    "   把逗号后面的 base64 解码保存为 PNG 文件即可。尺寸见 window.__cardSize。",
    "",
    "要换文案或样式，改链接里的参数就行，完整参数说明：" + location.origin + "/llms.txt",
  ].join("\n");
}

function buildShareUrl(embed) {
  const q = new URLSearchParams();
  const text = state.tab === "custom" ? state.customText : (state.selected ? state.selected.text : "");
  if (text) q.set("text", text);
  if (state.profile.name !== DEFAULT_PROFILE.name) q.set("name", state.profile.name);
  if (state.profile.handle !== DEFAULT_PROFILE.handle) q.set("handle", state.profile.handle);
  if (!state.profile.verified) q.set("verified", "0");
  if (state.mode !== "poster") q.set("mode", state.mode);
  if (state.theme !== "light") q.set("theme", state.theme);
  // 与初始默认值一致的项不写进链接，保持简短（省略时页面会用同样的默认值）
  if (state.cardWidth !== 100) q.set("width", state.cardWidth);
  if (!state.fontAuto) q.set("font", state.fontSize);
  if (state.cardOpacity !== 100) q.set("opacity", state.cardOpacity);
  if (state.bgDim !== 0) q.set("dim", state.bgDim);
  if (Math.round(state.cardX) !== 0) q.set("x", Math.round(state.cardX));
  if (Math.round(state.cardY) !== 0) q.set("y", Math.round(state.cardY));
  if (!state.metricsOn) q.set("metrics", "off");
  if (state.bgKey && state.bgKey.startsWith("builtin:")) q.set("bg", state.bgKey.replace("builtin:", "").replace(/\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i, ""));
  else if (state.bgKey && state.bgKey.startsWith("local:")) q.set("bg", state.bgKey);
  if (embed) q.set("embed", "1");
  return location.origin + location.pathname + "?" + q.toString();
}

async function init() {
  const q = new URLSearchParams(location.search);
  // embed 模式忽略本机 localStorage（保留 profile.json 默认身份），
  // 保证同一条链接在任何设备上结果一致
  await loadProfile(q.get("embed") !== "1");

  state.posts = await loadPosts();
  try {
    state.backgrounds = (await fetch("backgrounds/manifest.json").then((r) => r.json())).map((item) => ({ ...item, source: "builtin" }));
  } catch { state.backgrounds = []; }
  try {
    const locals = await readLocalBackgrounds();
    state.backgrounds = [...locals, ...state.backgrounds];
    if (locals.length) setBackgroundStatus(`已载入 ${locals.length} 张本地背景。`, "success");
  } catch (error) {
    console.error(error);
    setBackgroundStatus("浏览器无法读取本地背景库，仍可使用内置背景。", "error");
  }
  rollMetrics();

  const embed = await applyUrlParams();

  refreshLibrary();
  bind();
  initDrag();
  syncGuides();
  syncControls();
  renderBackgroundGrid();
  fitStageScale();
  window.addEventListener("resize", fitStageScale);
  window.addEventListener("beforeunload", () => revokeLocalBackgroundUrls());
  if (state.tab === "custom") { $("custom-text").value = state.customText; $("tab-custom").click(); }
  else if (state.posts.length) selectPost(state.posts[0]);

  if (embed) runEmbed();
}

init();
