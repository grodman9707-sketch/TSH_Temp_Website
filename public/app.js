const TOKEN_KEY = "tsh_token";
const REMEMBER_KEY = "tsh_remember";
const $ = (sel, el = document) => el.querySelector(sel);

const state = {
  path: location.pathname,
  user: null,
  menu: false,
  data: {},
  error: "",
  notice: "",
  selectedResultId: null,
  signup: {
    step: 1,
    name: "",
    email: "",
    password: "",
    regional: "",
    dartcounterName: "",
    nickname: "",
    avg: "",
  },
};

function token() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
function wantsRemember() {
  try {
    return localStorage.getItem(REMEMBER_KEY) === "1";
  } catch {
    return false;
  }
}
function storeToken(tok, remember) {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (remember) localStorage.setItem(REMEMBER_KEY, "1");
    else localStorage.removeItem(REMEMBER_KEY);
    if (!tok) return;
    if (remember) localStorage.setItem(TOKEN_KEY, tok);
    else sessionStorage.setItem(TOKEN_KEY, tok);
  } catch {
    /* private mode */
  }
}
function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* private mode */
  }
}
function avatarImg(user, size = 40) {
  if (!user) return "";
  const label = esc(user.nickname || user.name || "Player");
  if (user.hasAvatar || user.avatarUrl) {
    return `<img src="${esc(user.avatarUrl || `/api/users/${user.id}/avatar`)}" alt="${label}" class="avatar" width="${size}" height="${size}" style="width:${size}px;height:${size}px">`;
  }
  const letter = String(user.nickname || user.name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `<span class="avatar avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.max(12, Math.round(size * 0.4))}px">${letter}</span>`;
}
function userRoles(u) {
  const roles = Array.isArray(u?.roles) ? u.roles.map(String) : [];
  if (u?.role && u.role !== "player") roles.unshift(String(u.role));
  return [...new Set(roles.filter((r) => r && r !== "player"))];
}
function hasRole(u, role) {
  if (!u) return false;
  if (role === "player") return true;
  return userRoles(u).includes(role);
}
function roleLabel(u) {
  const roles = userRoles(u);
  const labels = [];
  if (roles.includes("owner")) labels.push("Owner");
  if (roles.includes("head_admin")) labels.push("Head Admin");
  if (roles.includes("admin")) labels.push("Division Admin");
  return labels.length ? labels.join(" · ") : "Player";
}
function isOwner(u = state.user) {
  return hasRole(u, "owner");
}
function isHeadAdmin(u = state.user) {
  return hasRole(u, "head_admin");
}
function canOverride(u = state.user) {
  return isOwner(u) || isHeadAdmin(u);
}
function isStaff(u = state.user) {
  return hasRole(u, "owner") || hasRole(u, "head_admin") || hasRole(u, "admin");
}
function userLeagueIds(u) {
  const ids = Array.isArray(u?.leagueIds) ? u.leagueIds.map(Number) : [];
  if (u?.leagueId) ids.unshift(Number(u.leagueId));
  return [...new Set(ids.filter(Boolean))];
}
function screenshotUrl(id, slot = 1) {
  return `/api/fixtures/${id}/screenshot?slot=${slot}&token=${encodeURIComponent(token())}`;
}
function nDisp(v) {
  return v || v === 0 ? v : "";
}
function sideStat(f, side, key) {
  const src = f.status === "played" ? f : f.extractedStats && Object.keys(f.extractedStats).length ? { ...f, ...f.extractedStats } : f;
  if (key === "180") return nDisp(src[`${side}180`] ?? src[`${side}OneEighties`]);
  return nDisp(src[`${side}${key}`]);
}
function matchStatsForm(f, formKind, buttonLabel) {
  const field = (side, key, label, extra = "") =>
    `<label class="stat-field"><span>${label}</span><input name="${side}${key}" type="number" min="0" ${extra} value="${sideStat(f, side, key)}"></label>`;
  const col = (side, name) => `
    <div class="stat-col">
      <h3 class="stat-player">${esc(name)}</h3>
      ${field(side, "Legs", "Legs won", 'max="5" required')}
      ${field(side, "Avg", "3DA", 'step="0.01"')}
      ${field(side, "Checkout", "Highest checkout", 'max="170"')}
      ${field(side, "BestLeg", "Best leg (fewest darts)")}
      ${field(side, "60", "60+")}
      ${field(side, "80", "80+")}
      ${field(side, "100", "100+")}
      ${field(side, "120", "120+")}
      ${field(side, "140", "140+")}
      ${field(side, "160", "160+")}
      ${field(side, "180", "180s")}
    </div>`;
  return `<form class="stat-entry" data-form="${formKind}" data-id="${f.id}">
    <div class="stat-cols">${col("home", f.homeName)}${col("away", f.awayName)}</div>
    <button class="btn-gold w-full mt-4">${buttonLabel}</button>
  </form>`;
}
function matchShot(f, slot) {
  const has = slot === 2 ? f.screenshot2 : f.screenshot1;
  const by = slot === 2 ? f.screenshot2ByName : f.screenshot1ByName;
  return `<div class="shot-card current">
    <div class="text-xs uppercase tracking-widest text-muted">Screenshot ${slot}${by ? ` · ${esc(by)}` : ""}</div>
    ${
      has
        ? `<img class="result-shot mt-3" src="${screenshotUrl(f.id, slot)}" alt="Screenshot ${slot} for ${esc(f.homeName)} vs ${esc(f.awayName)}">`
        : `<div class="shot-empty mt-3">Screenshot ${slot} not uploaded yet</div>`
    }
  </div>`;
}
function statsDesk(matches, selectedId, { formKind, buttonLabel, emptyText, actions } = {}) {
  if (!matches.length) return `<p class="mt-3 text-muted">${emptyText || "Nothing waiting."}</p>`;
  const selected = matches.find((f) => f.id === Number(selectedId)) || matches[0];
  return `<div class="match-picker">
      ${matches
        .map(
          (f) =>
            `<button type="button" class="match-chip${f.id === selected.id ? " selected" : ""}" data-act="pick-result" data-id="${f.id}">
              ${esc(f.homeName)} vs ${esc(f.awayName)}
              <span>Week ${f.week}${f.screenshotCount ? ` · ${f.screenshotCount}/2 shots` : ""}${f.extractedPending ? " · extracted" : ""}</span>
            </button>`
        )
        .join("")}
    </div>
    <div class="stats-desk">
      <div class="stats-shots">
        ${matchShot(selected, 1)}
        ${matchShot(selected, 2)}
      </div>
      <div class="stats-form-wrap">
        <div class="text-xs uppercase tracking-widest text-muted">${esc(selected.leagueName)} · Week ${selected.week}</div>
        <h3 class="mt-1 font-semibold">${esc(selected.homeName)} vs ${esc(selected.awayName)}</h3>
        <p class="mt-1 text-sm text-muted">${
          selected.extractedStats
            ? "Stats were read from the screenshots. Check every number, correct anything that looks wrong, then save. Nothing hits the table until you verify."
            : "Enter stats for each player from this match’s two screenshots. Saving updates the league table (1 point per leg + 2 for the win)."
        }</p>
        ${selected.extractedStats ? `<p class="mt-2 text-xs font-bold tracking-widest gold">EXTRACTED · AWAITING YOUR VERIFY</p>` : ""}
        <form class="mt-3" data-form="SCANSTATS" data-id="${selected.id}"><button type="submit" class="btn-ghost">SCAN SCREENSHOTS</button></form>
        ${matchStatsForm(selected, formKind, buttonLabel)}
        ${actions ? actions(selected) : ""}
      </div>
    </div>`;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read screenshot"));
    reader.readAsDataURL(file);
  });
}
function fileToAvatarDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 512;
      const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
      canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that photo. Use a PNG, JPG, or WEBP."));
    };
    img.src = url;
  });
}

let tesseractLoader = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoader) return tesseractLoader;
  tesseractLoader = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => {
      tesseractLoader = null;
      reject(new Error("Could not load screenshot reader"));
    };
    document.head.appendChild(s);
  });
  return tesseractLoader;
}

function nameHits(text, name) {
  if (!name) return 0;
  const t = String(text).toLowerCase();
  const n = String(name).toLowerCase().trim();
  if (!n) return 0;
  if (t.includes(n)) return 3;
  return n.split(/\s+/).filter((p) => p.length > 2 && t.includes(p)).length;
}

function firstNum(text, re) {
  const m = String(text).match(re);
  return m ? Number(m[1]) : null;
}

function parsePlayerBlock(text) {
  const t = String(text);
  return {
    Legs: firstNum(t, /(?:legs?\s*(?:won)?|score)\s*[:.]?\s*(\d{1,2})/i),
    Avg: firstNum(t, /(?:3[\s-]?d(?:art)?\s*a(?:verage)?|3da|average|avg)\s*[:.]?\s*(\d{1,3}(?:\.\d{1,2})?)/i),
    Checkout: firstNum(t, /(?:highest\s*)?(?:co|checkout|check\s*out)\s*[:.]?\s*(\d{1,3})/i),
    BestLeg: firstNum(t, /(?:best\s*leg|fewest\s*darts)\s*[:.]?\s*(\d{1,3})/i),
    60: firstNum(t, /(?:60\+|60\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    80: firstNum(t, /(?:80\+|80\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    100: firstNum(t, /(?:100\+|100\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    120: firstNum(t, /(?:120\+|120\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    140: firstNum(t, /(?:140\+|140\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    160: firstNum(t, /(?:160\+|160\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    180: firstNum(t, /(?:180s?|one\s*eight(?:y|ies))\s*[:.]?\s*(\d{1,3})/i),
  };
}

function parseDartCounterText(text, homeName, awayName) {
  const raw = String(text || "").replace(/\u00a0/g, " ");
  const stats = {};
  const score = raw.match(/\b([0-5])\s*[-–:]\s*([0-5])\b/);
  if (score) {
    const a = Number(score[1]);
    const b = Number(score[2]);
    const before = raw.slice(0, score.index).toLowerCase();
    const homeFirst = nameHits(before, homeName) >= nameHits(before, awayName);
    stats.homeLegs = homeFirst ? a : b;
    stats.awayLegs = homeFirst ? b : a;
  }
  const mid = Math.floor(raw.length / 2);
  const homeIdx = raw.toLowerCase().indexOf(String(homeName || "").toLowerCase());
  const awayIdx = raw.toLowerCase().indexOf(String(awayName || "").toLowerCase());
  let homeBlock = raw.slice(0, mid);
  let awayBlock = raw.slice(mid);
  if (homeIdx >= 0 && awayIdx >= 0 && homeIdx !== awayIdx) {
    if (homeIdx < awayIdx) {
      homeBlock = raw.slice(homeIdx, awayIdx);
      awayBlock = raw.slice(awayIdx);
    } else {
      awayBlock = raw.slice(awayIdx, homeIdx);
      homeBlock = raw.slice(homeIdx);
    }
  } else if (nameHits(raw.slice(0, mid), awayName) > nameHits(raw.slice(0, mid), homeName)) {
    homeBlock = raw.slice(mid);
    awayBlock = raw.slice(0, mid);
  }
  const home = parsePlayerBlock(homeBlock);
  const away = parsePlayerBlock(awayBlock);
  const both = parsePlayerBlock(raw);
  const assign = (side, parsed, fallback) => {
    for (const [key, val] of Object.entries(parsed)) {
      const field = `${side}${key}`;
      const v = val != null ? val : fallback[key];
      if (v == null || Number.isNaN(v)) continue;
      if (stats[field] == null) stats[field] = v;
    }
  };
  assign("home", home, both);
  assign("away", away, both);
  if (stats.home180 != null) stats.homeOneEighties = stats.home180;
  if (stats.away180 != null) stats.awayOneEighties = stats.away180;
  stats.rawText = raw.slice(0, 2500);
  return stats;
}

async function ocrImage(src) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker("eng");
  try {
    const { data } = await worker.recognize(src);
    return data?.text || "";
  } finally {
    await worker.terminate();
  }
}

async function ocrFixtureStats(fixture, extraSrcs = []) {
  const srcs = [...extraSrcs];
  if (fixture.screenshot1) srcs.push(screenshotUrl(fixture.id, 1));
  if (fixture.screenshot2) srcs.push(screenshotUrl(fixture.id, 2));
  const unique = [...new Set(srcs.filter(Boolean))];
  if (!unique.length) return null;
  const texts = [];
  for (const src of unique) {
    try {
      texts.push(await ocrImage(src));
    } catch {
      /* keep going */
    }
  }
  const merged = parseDartCounterText(texts.join("\n\n"), fixture.homeName, fixture.awayName);
  const keys = Object.keys(merged).filter((k) => k !== "rawText");
  if (!keys.length) return null;
  return merged;
}
function fixtureStatus(f) {
  if (f.status === "played") return `<div class="text-2xl font-extrabold gold">${f.homeLegs} – ${f.awayLegs}</div>`;
  if (f.status === "submitted" || f.hasBothScreenshots) return `<div class="text-xs font-bold tracking-widest gold">${f.extractedPending ? "STATS TO VERIFY" : "AWAITING ADMIN"}</div>`;
  if (f.screenshotCount) return `<div class="text-xs font-bold tracking-widest gold">${f.screenshotCount}/2 SCREENSHOTS</div>`;
  return `<div class="text-xs font-bold tracking-widest text-red-500">${f.scheduleStatus === "agreed" ? "AGREED" : f.scheduleStatus === "proposed" ? "TIME PROPOSED" : "SCHEDULED"}</div>`;
}
function fixtureWhen(f) {
  const bits = [`Week ${f.week}`];
  if (f.season && Number(f.season) !== 1) bits[0] = `Season ${f.season} · ${bits[0]}`;
  if (f.when) bits.push(f.when);
  else if (f.date) bits.push(f.time ? `${f.date} ${f.time}` : f.date);
  return bits.join(" · ");
}
function toLocalInput(date, time) {
  if (!date) return "";
  const t = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "19:00";
  return `${date}T${t}`;
}
function inThisMatch(f, u = state.user) {
  if (!u || !f) return false;
  return Number(f.homeId) === Number(u.id) || Number(f.awayId) === Number(u.id);
}
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(path, { credentials: "same-origin", ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
function go(path) {
  history.pushState({}, "", path);
  state.path = path;
  state.menu = false;
  state.error = "";
  state.notice = "";
  render();
}
window.addEventListener("popstate", () => {
  state.path = location.pathname;
  render();
});
const CRESTS = {
  main: "/images/tsh-main-crest.png",
  europe: "/images/tsh-europe-crest.png",
  americas: "/images/tsh-america-crest.png",
};
function crest(size = 64, which = "main") {
  const src = CRESTS[which] || CRESTS.main;
  return `<img src="${src}" alt="TSH" class="crest-img" width="${size}" height="${size}" style="width:${size}px;height:${size}px">`;
}
function regionalCrest(slug) {
  if (slug === "europe") return "europe";
  if (slug === "americas" || slug === "america") return "americas";
  return "main";
}
function layout(inner, { arena = false, home = false } = {}) {
  const links = [
    ["/", "Home"],
    ["/regionals", "Regionals"],
    ["/apply", "Apply"],
    ["/announcements", "News"],
    ["/rules", "Rules"],
    ["/contact", "Contact"],
  ];
  if (state.user) {
    links.push(["/dashboard", "Dashboard"], ["/my-matches", "My Matches"]);
    if (isStaff()) links.push(["/admin", "Admin"]);
  }
  return `
    <div class="${home ? "arena-bg arena-home min-h-screen" : "min-h-screen bg-background"}">
      ${state.menu ? `<div class="nav-overlay" data-act="close-menu"></div>` : ""}
      <aside class="sidebar ${state.menu ? "open" : ""}">
        <div class="flex items-center justify-between px-4 py-4">
          <div class="flex items-center gap-2">${crest(44)}<span class="gold font-bold tracking-widest">TSH</span></div>
          <button class="btn-ghost" data-act="close-menu">✕</button>
        </div>
        <nav class="py-2">
          ${links
            .map(
              ([href, label]) =>
                `<a href="${href}" class="block px-5 py-3 text-sm font-semibold tracking-widest uppercase ${state.path === href ? "gold" : "text-white/80 hover:text-primary"}">${label}</a>`
            )
            .join("")}
        </nav>
        <div class="mt-auto p-4 text-xs text-muted">${state.user ? `<button class="btn-ghost w-full" data-act="logout">Sign out ${esc(state.user.name)}</button>` : "Formerly World Darts League"}</div>
      </aside>
      <nav class="sticky top-0 z-30 border-b border-white/10 ${home ? "bg-black/30 backdrop-blur" : "bg-background"}">
        <div class="flex h-14 items-center justify-between px-4">
          <button class="h-10 w-10 rounded border border-white/15 hover:border-primary" data-act="open-menu">☰</button>
          <a href="/" class="flex items-center">${crest(56)}</a>
          <div class="flex gap-2">
            ${
              state.user
                ? `<a href="/dashboard" class="inline-flex items-center gap-2 btn-gold py-1 pl-1 pr-3">${avatarImg(state.user, 28)}<span>${esc((state.user.nickname || state.user.name).split(" ")[0].toUpperCase())}</span></a>`
                : `<a href="/sign-up" class="btn-gold">SIGN UP</a><a href="/sign-in" class="btn-ghost hidden sm:inline-flex">SIGN IN</a>`
            }
          </div>
        </div>
      </nav>
      <div class="${arena ? "arena-bg min-h-[calc(100vh-3.5rem)]" : ""}">${inner}</div>
    </div>`;
}
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function panel(html, extra = "") {
  return `<div class="glass rounded-xl p-5 ${extra}">${html}</div>`;
}

async function pageHome() {
  const [stats, content, regionals, tickerData] = await Promise.all([
    api("/api/stats"),
    api("/api/content"),
    api("/api/regionals"),
    api("/api/ticker").catch(() => ({ items: [] })),
  ]);
  let ticker = Array.isArray(tickerData.items) ? tickerData.items : [];
  if (!ticker.length) ticker = [{ div: "PDC", text: "Upcoming live darts dates will appear here", live: false }];
  const loop = [...ticker, ...ticker];
  const faq = content.content.faq || [];
  return layout(
    `
    <section class="relative flex min-h-[calc(100vh-3.5rem)] flex-col justify-end pb-24 pt-10">
      <div class="relative z-10 px-6 md:px-12">
        <p class="mb-3 text-xs font-semibold tracking-[0.35em] gold">THE SOCIAL HUB PRESENTS</p>
        <h1 class="max-w-xl text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-7xl">WHERE THE<br><span class="gold">CHAMPIONS</span><br>COMPETE</h1>
      </div>
      <p class="relative z-10 mx-auto mt-16 max-w-3xl px-6 text-center text-sm leading-relaxed text-white/80">${esc(content.content.hero_description)}</p>
      <div class="absolute bottom-0 left-0 right-0 overflow-hidden border-t border-white/10 bg-black/70">
        <div class="ticker flex w-max gap-10 whitespace-nowrap py-2 text-xs font-semibold tracking-wider">
          ${loop
            .map(
              (item) =>
                `<span class="flex items-center gap-3"><span class="gold">${esc(item.div)}</span><span class="text-white/80">• ${esc(item.text)}</span>${item.live ? `<span class="rounded bg-red-600 px-1.5 py-0.5 text-[10px]">LIVE</span>` : ""}</span>`
            )
            .join("")}
        </div>
      </div>
    </section>
    <section class="bg-background px-6 py-20">
      <div class="mx-auto max-w-5xl text-center">
        <h2 class="text-3xl font-bold">TSH In Numbers</h2>
        <p class="mt-3 text-muted">Formerly World Darts League. Live numbers from the current season.</p>
        <p class="mt-2 text-xs gold">● Live data</p>
        <div class="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          ${[
            [stats.activePlayers, "Active Players"],
            [stats.divisions, "Divisions"],
            [stats.total180s, "Total 180s"],
            [stats.topCheckout, "Top Checkout"],
          ]
            .map(([v, l]) => `<div class="glass rounded-xl px-4 py-8"><div class="text-4xl font-extrabold gold">${v}</div><div class="mt-2 text-xs font-semibold uppercase tracking-widest text-muted">${l}</div></div>`)
            .join("")}
        </div>
      </div>
    </section>
    <section class="bg-background px-6 pb-20">
      <div class="mx-auto max-w-5xl text-center">
        <h2 class="text-3xl font-bold">Join Our Active Communities</h2>
        <p class="mt-3 text-muted">${esc(content.content.communities_description)}</p>
        <div class="mt-10 grid gap-4 md:grid-cols-2">
          ${regionals.regionals
            .map(
              (r) =>
                `<a href="/regionals/${r.slug}" class="glass flex items-center gap-5 rounded-xl p-6 text-left hover:border-primary">${crest(96, regionalCrest(r.slug))}<div><h3 class="text-xl font-bold">${esc(r.fullTitle)}</h3><p class="mt-2 text-sm text-muted">${esc(r.region)} — climb the divisions weekly.</p></div></a>`
            )
            .join("")}
        </div>
      </div>
    </section>
    <section class="bg-background px-6 pb-20">
      <div class="mx-auto max-w-3xl">
        <h2 class="text-center text-3xl font-bold">Frequently Asked Questions</h2>
        <div class="mt-8 space-y-2" id="faq">
          ${faq
            .map(
              (item, i) =>
                `<button class="glass flex w-full flex-col rounded-xl px-5 py-4 text-left" data-faq="${i}"><span class="flex items-center justify-between font-semibold">${esc(item.q)} <span>▾</span></span><span class="faq-a mt-3 hidden text-sm text-muted">${esc(item.a)}</span></button>`
            )
            .join("")}
        </div>
      </div>
    </section>
    <footer class="border-t border-white/10 bg-[#07090f] px-6 py-12">
      <div class="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
        <div>
          <img src="${CRESTS.main}" alt="TSH" class="mb-3" style="width:88px;height:88px;object-fit:contain">
          <h3 class="text-lg font-bold">The Social Hub Darts League</h3>
          <p class="mt-2 text-sm text-muted">Formerly World Darts League (WDL)</p>
          <a class="mt-3 inline-block text-sm gold" href="mailto:worlddartsleagueinfo@gmail.com">worlddartsleagueinfo@gmail.com</a>
        </div>
        <div>
          <h3 class="text-lg font-bold">Join the league</h3>
          <p class="mt-3 text-sm text-muted">Free to enter. Create an account and we will place you by your DartCounter average.</p>
          <div class="mt-4 flex gap-3"><a href="/sign-up" class="btn-gold">SIGN UP</a><a href="/rules" class="btn-ghost">Rules</a></div>
        </div>
      </div>
      <p class="mx-auto mt-10 max-w-5xl text-xs text-muted">© 2026 The Social Hub Darts League. All rights reserved.</p>
    </footer>
  `,
    { home: true }
  );
}

async function pageRegionals() {
  const d = await api("/api/regionals");
  return layout(
    `<div class="mx-auto max-w-xl px-4 py-10">
      <a href="/" class="gold text-sm font-bold">← TSH</a>
      ${panel(`<div class="text-center"><div class="gold mx-auto mb-3 text-xl">◎</div><h1 class="text-3xl font-extrabold tracking-widest">REGIONALS</h1><p class="mt-2 text-sm text-muted">Find your region and compete</p></div>`)}
      <div class="mt-4 space-y-3">
        ${d.regionals
          .map(
            (r) =>
              `<a href="/regionals/${r.slug}" class="glass flex items-center justify-between gap-4 rounded-xl px-5 py-4"><div><div class="text-lg font-bold">${esc(r.fullTitle)}</div><div class="text-sm text-muted">${esc(r.region)}</div></div>${crest(72, regionalCrest(r.slug))}</a>`
          )
          .join("")}
      </div>
    </div>`,
    { arena: true }
  );
}

async function pageRegional(slug) {
  const d = await api(`/api/regionals/${slug}`);
  const r = d.regional;
  return layout(
    `<div class="mx-auto max-w-xl px-4 py-10">
      <a href="/regionals" class="gold">←</a>
      <div class="mt-2 text-xl font-bold">${esc(r.fullTitle)}</div>
      ${panel(`<div class="text-center"><img src="${CRESTS[regionalCrest(r.slug)]}" alt="${esc(r.fullTitle)}" class="crest-regional mx-auto"><div class="mt-3 text-sm font-bold tracking-[0.3em] gold">${esc(r.name.toUpperCase())}</div></div>`, "mt-6")}
      <a href="/rules" class="glass mt-3 flex items-center justify-between rounded-xl px-5 py-4"><span>📘 ${esc(r.fullTitle)} Rules</span><span class="text-sm text-muted">Read more ></span></a>
      <div class="mt-4 grid grid-cols-3 gap-3">
        ${[
          [d.counts.players, "PLAYERS"],
          [d.counts.teams, "TEAMS"],
          [d.counts.leagues, "LEAGUES"],
        ]
          .map(([v, l]) => panel(`<div class="text-center"><div class="text-3xl font-extrabold">${v}</div><div class="mt-1 text-[11px] tracking-widest text-muted">${l}</div></div>`))
          .join("")}
      </div>
      <h2 class="mt-10 text-sm font-bold tracking-widest gold">LEAGUES</h2>
      <div class="mt-3 space-y-3">
        ${d.leagues
          .map(
            (l) =>
              `<a href="/regionals/${slug}/leagues/${l.id}" class="glass flex items-center justify-between rounded-xl px-5 py-4"><div><div class="font-bold">${esc(l.name)}</div><div class="text-sm text-muted">${esc(l.format)}${
                (l.divisionAdmins || []).length ? ` · Admin: ${esc(l.divisionAdmins.map((a) => a.nickname || a.name).join(", "))}` : ""
              }</div></div><span class="text-xs font-semibold tracking-widest gold">TABLE</span></a>`
          )
          .join("")}
      </div>
    </div>`,
    { arena: true }
  );
}

async function pageLeague(slug, id) {
  const d = await api(`/api/leagues/${id}`);
  const tab = new URLSearchParams(location.search).get("tab") || "table";
  return layout(
    `<div class="mx-auto max-w-5xl px-4 py-10">
      <a href="/regionals/${slug}" class="gold text-sm font-bold inline-flex items-center gap-2">${crest(36, regionalCrest(slug))} ← ${esc(d.regional?.fullTitle || "")}</a>
      ${panel(`<div class="text-center"><h1 class="text-3xl font-extrabold tracking-widest">${esc(d.league.name.toUpperCase())}</h1><p class="mt-2 text-sm text-muted">${esc(d.league.format)} · 1 point per leg won + 2 for the match win</p></div>`, "mt-4")}
      ${panel(
        (d.divisionAdmins || []).length
          ? `<div class="text-xs font-bold tracking-widest gold">THE ADMIN</div>
            <p class="mt-1 text-sm text-muted">For issues in this division, contact the admin listed here.</p>
            <div class="mt-3 space-y-3">${d.divisionAdmins
              .map(
                (a) =>
                  `<a href="/player/${a.id}" class="flex items-center gap-3">
                    ${avatarImg(a, 48)}
                    <div>
                      <div class="font-semibold">${esc(a.nickname || a.name)}</div>
                      <div class="text-sm text-muted">${esc(a.name)}${a.email ? ` · ${esc(a.email)}` : ""}${hasRole(a, "head_admin") ? " · Head Admin" : ""}</div>
                    </div>
                  </a>`
              )
              .join("")}</div>`
          : `<div class="text-xs font-bold tracking-widest gold">THE ADMIN</div><p class="mt-1 text-sm text-muted">No division admin assigned yet. Players can still reach league staff from Contact.</p>`,
        "mt-4"
      )}
      <div class="mt-4 flex gap-2">
        <a href="/regionals/${slug}/leagues/${id}" class="${tab === "table" ? "btn-gold" : "btn-ghost"}">TABLE</a>
        <a href="/regionals/${slug}/leagues/${id}?tab=fixtures" class="${tab === "fixtures" ? "btn-gold" : "btn-ghost"}">FIXTURES</a>
      </div>
      ${state.error ? `<p class="mt-3 text-sm text-red-400">${esc(state.error)}</p>` : ""}
      ${state.notice ? `<p class="mt-3 text-sm gold">${esc(state.notice)}</p>` : ""}
      ${
        tab === "fixtures"
          ? `<div class="mt-4 space-y-4">${
              d.fixtures.length
                ? d.fixtures
                    .slice()
                    .sort((a, b) => Number(a.week || 0) - Number(b.week || 0) || String(a.date || "").localeCompare(String(b.date || "")))
                    .map((f) => {
                      const mine = inThisMatch(f);
                      const proposed = f.scheduleStatus === "proposed" && f.proposedDate;
                      const proposalLine = proposed
                        ? `<div class="mt-1 text-xs gold">${esc(f.proposedByName || "Opponent")} proposed ${esc(f.proposedDate)} ${esc(f.proposedTime || "")}${
                            mine && Number(f.proposedBy) !== Number(state.user?.id) ? " · waiting on you" : mine ? " · waiting on opponent" : ""
                          }</div>`
                        : f.scheduleStatus === "agreed"
                          ? `<div class="mt-1 text-xs gold">Agreed: ${esc(f.date)} ${esc(f.time || "")}</div>`
                          : "";
                      const actions =
                        mine && f.status !== "played"
                          ? `<div class="mt-3 flex flex-wrap items-end gap-2">
                              <form class="flex flex-wrap items-end gap-2" data-form="PROPOSE" data-id="${f.id}">
                                <label class="text-[11px] uppercase tracking-widest text-muted">Propose date & time
                                  <input name="datetime" type="datetime-local" required value="${esc(
                                    toLocalInput(f.proposedDate || f.date, f.proposedTime || f.time)
                                  )}">
                                </label>
                                <button class="btn-gold">PROPOSE</button>
                              </form>
                              ${
                                proposed && Number(f.proposedBy) !== Number(state.user?.id)
                                  ? `<form data-form="ACCEPTTIME" data-id="${f.id}"><button class="btn-gold">ACCEPT TIME</button></form>`
                                  : ""
                              }
                              <a href="/my-matches?fixture=${f.id}" class="btn-gold">SUBMIT SCREENSHOTS</a>
                            </div>`
                          : !state.user && f.status !== "played"
                            ? `<div class="mt-3"><a href="/sign-in" class="text-xs font-bold tracking-widest gold">SIGN IN TO PROPOSE A TIME OR SUBMIT SCREENSHOTS</a></div>`
                            : "";
                      return panel(
                        `<div id="fixture-${f.id}" class="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div class="text-xs uppercase tracking-widest text-muted">${esc(fixtureWhen(f))}</div>
                            <div class="mt-1 font-semibold">${esc(f.homeName)} vs ${esc(f.awayName)}</div>
                            ${proposalLine}
                            ${actions}
                          </div>
                          <div>${fixtureStatus(f)}</div>
                        </div>`
                      );
                    })
                    .join("")
                : `<p class="text-sm text-muted">No fixtures yet. Division admins can generate a season from the Admin desk.</p>`
            }</div>`
          : `<div class="glass table-wrap mt-4 rounded-xl"><table><thead><tr>${["#", "Player", "P", "W", "L", "LF", "LA", "+/-", "Pts", "Avg", "180s"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${d.standings
              .map(
                (row, i) =>
                  `<tr><td class="gold">${i + 1}</td><td><a href="/player/${row.playerId}" class="inline-flex items-center gap-2">${avatarImg({ id: row.playerId, name: row.name, nickname: row.nickname, hasAvatar: row.hasAvatar, avatarUrl: row.hasAvatar ? `/api/users/${row.playerId}/avatar` : "" }, 28)}${esc(row.name)}</a></td><td>${row.played}</td><td>${row.won}</td><td>${row.lost}</td><td>${row.legsFor}</td><td>${row.legsAgainst}</td><td>${row.diff}</td><td class="gold font-bold">${row.points}</td><td>${Number(row.avg || 0).toFixed(1)}</td><td>${row.oneEighties || 0}</td></tr>`
              )
              .join("")}</tbody></table></div>`
      }
    </div>`,
    { arena: true }
  );
}

function passwordField(name, placeholder, autocomplete, extra = "") {
  return `<div class="password-wrap">
    <input name="${name}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" ${extra}>
    <button type="button" class="password-toggle" data-act="toggle-password" aria-label="Show password">Show</button>
  </div>`;
}
function authForm(title, fields, submitLabel, extra = "") {
  return layout(
    `<div class="mx-auto max-w-md px-4 py-10">${panel(`
      <h1 class="text-3xl font-extrabold">${title}</h1>
      ${extra}
      ${state.error ? `<p class="mt-3 text-sm text-red-400">${esc(state.error)}</p>` : ""}
      ${state.notice ? `<p class="mt-3 text-sm gold">${esc(state.notice)}</p>` : ""}
      <form class="mt-6 space-y-4" data-form="${submitLabel}">
        ${fields}
        <button class="btn-gold w-full py-3">${submitLabel}</button>
      </form>
    `)}</div>`,
    { arena: true }
  );
}

function pageSignIn() {
  return authForm(
    "Sign in",
    `<input name="email" type="text" placeholder="Username or email" required autocomplete="username">
     ${passwordField("password", "Password", "current-password", "required")}
     <label class="check-row"><input type="checkbox" name="remember" value="1"> Remember me</label>`,
    "SIGN IN",
    `<p class="mt-4 text-sm text-muted">New here? <a class="gold" href="/sign-up">Create an account</a></p>`
  );
}
function pageSignUp() {
  const s = state.signup;
  const step = s.step || 1;
  const total = 5;
  const labels = ["Account", "Regional", "DartCounter", "Nickname", "3DA"];
  const dots = labels
    .map((label, i) => {
      const n = i + 1;
      const on = n === step;
      const done = n < step;
      return `<div class="flex-1 text-center"><div class="mx-auto h-1.5 rounded ${done || on ? "bg-primary" : "bg-white/15"}"></div><div class="mt-2 text-[10px] tracking-widest ${on ? "gold" : "text-muted"}">${label.toUpperCase()}</div></div>`;
    })
    .join("");

  let body = "";
  if (step === 1) {
    body = `
      <label class="block text-xs font-semibold uppercase tracking-widest text-muted">Name</label>
      <input name="name" value="${esc(s.name)}" placeholder="Your name" required autocomplete="name">
      <label class="block text-xs font-semibold uppercase tracking-widest text-muted">E-mail</label>
      <input name="email" type="email" value="${esc(s.email)}" placeholder="you@email.com" required autocomplete="email">
      <label class="block text-xs font-semibold uppercase tracking-widest text-muted">Password</label>
      ${passwordField("password", "Password", "new-password", `required value="${esc(s.password)}"`)}
    `;
  } else if (step === 2) {
    const opt = (key, title, img, note) => `
      <button type="button" class="region-card ${s.regional === key ? "selected" : ""}" data-act="signup-region" data-region="${key}">
        <img src="${img}" alt="${title}" class="mx-auto" style="width:108px;height:108px;object-fit:contain">
        <div class="mt-3 font-bold">${title}</div>
        <div class="mt-1 text-xs text-muted">${note}</div>
      </button>`;
    body = `
      <p class="text-sm text-muted">Choose where you want to compete. Both lets you play in one Europe league and one Americas league.</p>
      <div class="grid gap-3">
        ${opt("europe", "TSH Europe", CRESTS.europe, "United Kingdom & Europe")}
        ${opt("americas", "TSH Americas", CRESTS.americas, "North & South America")}
        ${opt("both", "Both", CRESTS.main, "One Europe league and one Americas league")}
      </div>
      ${!s.regional && state.error ? "" : ""}
    `;
  } else if (step === 3) {
    body = `
      <label class="block text-xs font-semibold uppercase tracking-widest text-muted">DartCounter display name</label>
      <input name="dartcounterName" value="${esc(s.dartcounterName)}" placeholder="Exactly as it appears on DartCounter" required>
    `;
  } else if (step === 4) {
    body = `
      <label class="block text-xs font-semibold uppercase tracking-widest text-muted">Nickname <span class="normal-case tracking-normal">(if any)</span></label>
      <input name="nickname" value="${esc(s.nickname)}" placeholder="Optional">
      <p class="text-xs text-muted">Leave blank if you don’t use one.</p>
    `;
  } else {
    body = `
      <label class="block text-xs font-semibold uppercase tracking-widest text-muted">3DA</label>
      <input name="avg" data-numeric="avg" inputmode="decimal" autocomplete="off" value="${esc(s.avg)}" placeholder="Type your 3-dart average" required>
      <p class="text-xs text-muted">Numbers only, for example 54 or 62.5</p>
    `;
  }

  return layout(
    `<div class="mx-auto max-w-lg px-4 py-10">${panel(`
      <p class="text-xs font-semibold tracking-[0.3em] gold">STEP ${step} OF ${total}</p>
      <h1 class="mt-2 text-3xl font-extrabold">Sign up</h1>
      <div class="mt-5 flex gap-2">${dots}</div>
      ${state.error ? `<p class="mt-4 text-sm text-red-400">${esc(state.error)}</p>` : ""}
      <form class="mt-6 space-y-4" data-form="SIGNUP" data-step="${step}">
        ${body}
        <div class="flex gap-3 pt-2">
          ${step > 1 ? `<button type="button" class="btn-ghost flex-1" data-act="signup-back">BACK</button>` : ""}
          <button class="btn-gold flex-1 py-3">${step === 5 ? "JOIN TSH" : "CONTINUE"}</button>
        </div>
      </form>
      <p class="mt-4 text-center text-sm text-muted">Already registered? <a class="gold" href="/sign-in">Sign in</a></p>
    `)}</div>`,
    { arena: true }
  );
}
async function pageApply() {
  const d = await api("/api/regionals");
  return layout(
    `<div class="mx-auto max-w-lg px-4 py-10">${panel(`
      <p class="text-xs font-semibold tracking-[0.3em] gold">JOIN THE LEAGUE</p>
      <h1 class="mt-2 text-3xl font-extrabold">Apply to TSH</h1>
      <p class="mt-2 text-sm text-muted">Free to enter. We place you by DartCounter average.</p>
      ${state.error ? `<p class="mt-3 text-sm text-red-400">${esc(state.error)}</p>` : ""}
      ${state.notice ? `<p class="mt-3 text-sm gold">${esc(state.notice)}</p>` : ""}
      <form class="mt-6 space-y-4" data-form="APPLY">
        <select name="regionalId">${d.regionals.map((r) => `<option value="${r.id}">${esc(r.fullTitle)}</option>`).join("")}</select>
        <input name="dartcounterName" placeholder="DartCounter username">
        <input name="avg" type="number" step="0.1" placeholder="3-dart average" required>
        <button class="btn-gold w-full py-3">${state.user ? "SUBMIT APPLICATION" : "SIGN UP TO APPLY"}</button>
      </form>
    `)}</div>`,
    { arena: true }
  );
}
async function pageDashboard() {
  const d = await api("/api/my-fixtures");
  const u = state.user;
  const next = d.fixtures.find((f) => f.status === "scheduled");
  const played = d.fixtures.filter((f) => f.status === "played");
  return layout(
    `<div class="mx-auto max-w-4xl px-4 py-10">
      <div class="flex flex-wrap items-center gap-4">
        ${avatarImg(u, 88)}
        <div>
          <p class="text-xs font-semibold tracking-[0.3em] gold">PLAYER HUB</p>
          <h1 class="mt-2 text-4xl font-extrabold">${esc(u.nickname || u.name)}</h1>
          <p class="mt-2 text-muted">${esc(roleLabel(u))}${(u.leagueTitles || []).length ? ` · ${esc(u.leagueTitles.join(" · "))}` : " · Awaiting division"}${u.dartcounterName ? ` · DartCounter: ${esc(u.dartcounterName)}` : ""}${u.avg ? ` · 3DA ${esc(u.avg)}` : ""}</p>
        </div>
      </div>
      ${state.error ? `<p class="mt-4 text-sm text-red-400">${esc(state.error)}</p>` : ""}
      ${state.notice ? `<p class="mt-4 text-sm gold">${esc(state.notice)}</p>` : ""}
      <div class="mt-6 grid gap-4 md:grid-cols-3">
        ${panel(`<div class="text-xs tracking-widest text-muted">NEXT MATCH</div><div class="mt-2 font-semibold">${next ? `${esc(next.homeName)} vs ${esc(next.awayName)}` : "None scheduled"}</div>${
          next
            ? `<div class="mt-2 text-xs text-muted">${esc(fixtureWhen(next))}</div>
               <div class="mt-3 flex flex-wrap gap-2">
                 <a href="/my-matches?fixture=${next.id}" class="btn-gold">SUBMIT SCREENSHOTS</a>
               </div>`
            : ""
        }`)}
        ${panel(`<div class="text-xs tracking-widest text-muted">RESULTS IN</div><div class="mt-2 text-3xl font-extrabold gold">${played.length}</div>`)}
        ${panel(`<div class="text-xs tracking-widest text-muted">AWAITING ADMIN</div><div class="mt-2 text-3xl font-extrabold gold">${d.fixtures.filter((f) => f.status === "submitted").length}</div>`)}
      </div>
      <a href="/my-matches" class="mt-6 inline-block text-sm font-bold tracking-widest gold">OPEN MY MATCHES →</a>

      <div class="mt-10 grid gap-4 md:grid-cols-2">
        ${panel(`<h2 class="text-lg font-bold">Player profile</h2>
          <p class="mt-1 text-sm text-muted">How you appear on tables and in matches.</p>
          <form class="mt-4 space-y-3" data-form="PROFILE">
            <label class="block text-xs font-semibold uppercase tracking-widest text-muted">Name</label>
            <input name="name" value="${esc(u.name || "")}" required>
            <label class="block text-xs font-semibold uppercase tracking-widest text-muted">Nickname</label>
            <input name="nickname" value="${esc(u.nickname || "")}" placeholder="Optional">
            <label class="block text-xs font-semibold uppercase tracking-widest text-muted">DartCounter name</label>
            <input name="dartcounterName" value="${esc(u.dartcounterName || "")}">
            <label class="block text-xs font-semibold uppercase tracking-widest text-muted">3DA</label>
            <input name="avg" data-numeric="avg" inputmode="decimal" value="${esc(u.avg || "")}">
            <button class="btn-gold">SAVE PROFILE</button>
          </form>`)}
        ${panel(`<h2 class="text-lg font-bold">User account</h2>
          <p class="mt-1 text-sm text-muted">Sign-in details. Role: ${esc(roleLabel(u))}.</p>
          <form class="mt-4 space-y-3" data-form="ACCOUNT">
            <label class="block text-xs font-semibold uppercase tracking-widest text-muted">Username</label>
            <input name="username" value="${esc(u.username || "")}" placeholder="Optional login name" autocomplete="username">
            <label class="block text-xs font-semibold uppercase tracking-widest text-muted">Email</label>
            <input name="email" type="email" value="${esc(u.email || "")}" required autocomplete="email">
            <label class="block text-xs font-semibold uppercase tracking-widest text-muted">Current password</label>
            ${passwordField("currentPassword", "Needed to change password", "current-password")}
            <label class="block text-xs font-semibold uppercase tracking-widest text-muted">New password</label>
            ${passwordField("newPassword", "Leave blank to keep current", "new-password")}
            <button class="btn-gold">SAVE ACCOUNT</button>
          </form>`)}
      </div>
      ${panel(`<h2 class="text-lg font-bold">Profile picture</h2>
        <p class="mt-1 text-sm text-muted">Phone photos, PNG, JPG, or WEBP. We resize it automatically. Shows on your dashboard, player page, and league table.</p>
        <div class="mt-4 flex flex-wrap items-center gap-4">${avatarImg(u, 72)}
          <form class="space-y-2" data-form="AVATAR">
            <input type="file" name="avatar" accept="image/*" required>
            <button class="btn-gold">UPLOAD PHOTO</button>
          </form>
        </div>`, "mt-4")}
    </div>`,
    { arena: true }
  );
}
async function pageMyMatches() {
  const d = await api("/api/my-fixtures");
  return layout(
    `<div class="mx-auto max-w-3xl px-4 py-10">
      <h1 class="text-3xl font-extrabold">My Matches</h1>
      <p class="mt-2 text-sm text-muted">Play on DartCounter. Upload both match screenshots (2). The site will try to read the stats; a division admin verifies them before they count.</p>
      ${state.error ? `<p class="mt-3 text-sm text-red-400">${esc(state.error)}</p>` : ""}
      ${state.notice ? `<p class="mt-3 text-sm gold">${esc(state.notice)}</p>` : ""}
      <div class="mt-6 space-y-3">
        ${d.fixtures
          .map((f) => {
            let action = fixtureStatus(f);
            if (f.status !== "played") {
              const slots = [1, 2].filter((slot) => !(slot === 1 ? f.screenshot1 : f.screenshot2));
              if (slots.length) {
                action = `<div class="space-y-2">${slots
                  .map(
                    (slot) => `<form class="space-y-2" data-form="UPLOAD" data-id="${f.id}" data-slot="${slot}">
                      <div class="text-[11px] font-bold tracking-widest text-muted">SCREENSHOT ${slot} OF 2</div>
                      <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" required>
                      <button class="btn-gold w-full">UPLOAD SCREENSHOT ${slot}</button>
                    </form>`
                  )
                  .join("")}</div>`;
              } else {
                action = `<div class="text-right"><div class="text-xs font-bold tracking-widest gold">BOTH SCREENSHOTS IN</div><div class="mt-1 text-xs text-muted">Waiting on admin to enter each player’s stats.</div></div>`;
              }
            }
            return panel(`<div id="fixture-${f.id}" class="grid gap-3 md:grid-cols-[1fr_220px] md:items-center ${new URLSearchParams(location.search).get("fixture") === String(f.id) ? "fixture-highlight" : ""}">
                <div><div class="text-xs uppercase tracking-widest text-muted">${esc(f.leagueName)} · ${esc(fixtureWhen(f))}</div>
                <div class="mt-1 text-lg font-semibold">${esc(f.homeName)} vs ${esc(f.awayName)}</div>
                <div class="mt-1 text-xs text-muted">${f.screenshotCount || 0}/2 screenshots uploaded${f.extractedStats ? " · stats extracted, awaiting admin verify" : ""}</div>
                ${
                  f.scheduleStatus === "proposed"
                    ? `<div class="mt-1 text-xs gold">${esc(f.proposedByName || "Opponent")} proposed ${esc(f.proposedDate)} ${esc(f.proposedTime || "")}</div>`
                    : f.scheduleStatus === "agreed"
                      ? `<div class="mt-1 text-xs gold">Agreed kickoff ${esc(f.date)} ${esc(f.time || "")}</div>`
                      : ""
                }
                ${
                  f.status !== "played"
                    ? `<form class="mt-3 flex flex-wrap items-end gap-2" data-form="PROPOSE" data-id="${f.id}">
                        <label class="text-[11px] uppercase tracking-widest text-muted">Propose date & time
                          <input name="datetime" type="datetime-local" required value="${esc(toLocalInput(f.proposedDate || f.date, f.proposedTime || f.time))}">
                        </label>
                        <button class="btn-gold">PROPOSE</button>
                      </form>`
                    : ""
                }
                ${
                  f.scheduleStatus === "proposed" && Number(f.proposedBy) !== Number(state.user?.id) && f.status !== "played"
                    ? `<form class="mt-2" data-form="ACCEPTTIME" data-id="${f.id}"><button class="btn-gold">ACCEPT TIME</button></form>`
                    : ""
                }
                </div>
                ${action}
              </div>`);
          })
          .join("")}
      </div>
    </div>`,
    { arena: true }
  );
}
async function pagePlayer(id) {
  const d = await api(`/api/player/${id}`);
  return layout(
    `<div class="mx-auto max-w-3xl px-4 py-10">
      ${panel(`<div class="flex items-center gap-4"><div>${avatarImg(d.player, 72)}</div><div><p class="text-xs tracking-[0.3em] gold">${esc((d.regionals || []).map((r) => r.fullTitle).join(" · ") || d.regional?.fullTitle || "Unplaced")}</p>
        <h1 class="mt-2 text-4xl font-extrabold">${esc(d.player.nickname || d.player.name)}</h1>
        <p class="mt-2 text-muted">${esc((d.leagues || []).map((l) => l.title || l.name).join(" · ") || d.league?.name || "Awaiting division")} · Avg ${esc(d.player.avg)}</p></div></div>`)}
      <div class="mt-4 space-y-3">${d.fixtures
        .map((f) => panel(`<div class="flex justify-between"><div>${esc(f.homeName)} vs ${esc(f.awayName)}<div class="text-xs text-muted">${esc(f.date)}</div></div><div class="font-bold gold">${f.status === "played" ? `${f.homeLegs}–${f.awayLegs}` : f.status === "submitted" ? "In review" : "TBD"}</div></div>`))
        .join("")}</div>
    </div>`,
    { arena: true }
  );
}
function pageRules() {
  return layout(
    `<div class="mx-auto max-w-3xl px-4 py-10">${panel(`
      <p class="text-xs font-semibold tracking-[0.3em] gold">TSH DARTS LEAGUE</p>
      <h1 class="mt-2 text-4xl font-extrabold">Rules</h1>
      <div class="mt-6 space-y-4 text-sm leading-relaxed text-white/80">
        <p>The Social Hub Darts League (formerly World Darts League) is a competitive online league played on DartCounter.</p>
        <h2 class="text-lg font-bold text-white">Format</h2>
        <ul class="list-disc space-y-1 pl-5">
          <li>501, double out.</li>
          <li>Each regional has League 1, League 2, League 3, and League 4.</li>
          <li>Players who choose Both can be placed in one Europe league and one Americas league.</li>
          <li>Every match is Best of 9 (first to 5 legs).</li>
          <li>1 point per leg won, plus 2 extra points for the match win.</li>
          <li>Example: win 5–3 and you score 7 points; your opponent scores 3.</li>
        </ul>
        <h2 class="text-lg font-bold text-white">Results</h2>
        <p>Either player from the fixture uploads both DartCounter screenshots (2). The site tries to read the stats; a division admin verifies them before they are added to the table.</p>
        <h2 class="text-lg font-bold text-white">Scheduling</h2>
        <p>Propose a date and time on the Fixtures tab, then play on DartCounter. Use Submit Screenshots on that same fixture. A person can hold more than one staff role — for example Division Admin and Head Admin together. Each division lists its Division Admin as The Admin for player issues. A Head Admin can override a confirmed result; owners assign those roles.</p>
      </div>
    `)}</div>`,
    { arena: true }
  );
}
function pageContact() {
  return layout(
    `<div class="mx-auto max-w-lg px-4 py-10">${panel(`<div class="text-center"><h1 class="text-3xl font-extrabold">Contact</h1><p class="mt-3 text-muted">Questions about TSH Darts League, formerly WDL.</p><a class="mt-6 inline-block gold" href="mailto:worlddartsleagueinfo@gmail.com">worlddartsleagueinfo@gmail.com</a></div>`)}</div>`,
    { arena: true }
  );
}
async function pageNews() {
  const d = await api("/api/announcements");
  return layout(
    `<div class="mx-auto max-w-3xl px-4 py-10"><h1 class="text-3xl font-extrabold">News</h1>
      <div class="mt-6 space-y-3">${d.announcements
        .map((item) => panel(`<div class="text-xs text-muted">${new Date(item.createdAt).toLocaleDateString()}</div><h2 class="mt-1 text-xl font-bold">${esc(item.title)}</h2><p class="mt-2 text-sm text-white/80">${esc(item.body)}</p>`))
        .join("")}</div></div>`,
    { arena: true }
  );
}
async function pageAdmin() {
  const d = await api("/api/admin/overview");
  const everyone = d.users;
  const registered = everyone;
  const leaguesById = Object.fromEntries((d.allLeagues || d.leagues).map((l) => [l.id, l]));
  const playerOption = (p) => {
    const names = userLeagueIds(p)
      .map((id) => leaguesById[id]?.title || leaguesById[id]?.name)
      .filter(Boolean);
    const where = names.length ? names.join(" · ") : "Unplaced";
    const both = p.regionalChoice === "both" ? " · Both" : "";
    const tags = [];
    if (hasRole(p, "owner")) tags.push("Owner");
    if (hasRole(p, "head_admin")) tags.push("Head Admin");
    if (hasRole(p, "admin")) tags.push("Division Admin");
    const tag = tags.length ? ` · ${tags.join(" · ")}` : "";
    return `<option value="${p.id}">${esc(p.name)}${tag}${both} · ${esc(where)}</option>`;
  };
  const pending = d.applications;
  const review = d.fixtures.filter((f) => f.status === "submitted" || f.hasBothScreenshots);
  const leagueOptions = d.leagues.map((l) => `<option value="${l.id}">${esc(l.title || l.name)}</option>`).join("");
  const allLeagueOptions = (d.allLeagues || d.leagues).map((l) => `<option value="${l.id}">${esc(l.title || l.name)}</option>`).join("");
  const ownerSection = d.isOwner
    ? `${panel(`<h2 class="text-lg font-bold">Owners (${d.ownerSlots.used}/${d.ownerSlots.max})</h2>
        <p class="mt-1 text-sm text-muted">Only these ${d.ownerSlots.max} people can assign Head Admins and Division Admins.</p>
        <div class="mt-3 space-y-2">${d.owners.map((o) => `<div class="text-sm">${esc(o.name)} · ${esc(o.email)}</div>`).join("")}</div>
        ${
          d.ownerSlots.used < d.ownerSlots.max
            ? `<form class="mt-4 grid gap-3 md:grid-cols-2" data-form="OWNER">
                <select name="userId" required><option value="">Registered player</option>${registered.filter((p) => !hasRole(p, "owner")).map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.email)}</option>`).join("")}</select>
                <button class="btn-gold">MAKE OWNER</button>
              </form>`
            : `<p class="mt-3 text-sm text-muted">All three owner slots are filled.</p>`
        }`, "mt-6")}
      ${panel(`<h2 class="text-lg font-bold">Head Admins</h2>
        <p class="mt-1 text-sm text-muted">Head Admins can override a confirmed result entered by another admin. They can also hold a Division Admin post at the same time.</p>
        <div class="mt-3 space-y-2">${
          (d.headAdmins || []).length
            ? d.headAdmins
                .map(
                  (a) =>
                    `<form class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-2 text-sm" data-form="REVOKE" data-id="${a.id}" data-role="head_admin">
                      <span>${esc(a.name)}${hasRole(a, "admin") ? ` · also Division Admin${(a.adminLeagueTitles || []).length ? ` (${esc(a.adminLeagueTitles.join(", "))})` : ""}` : ""}</span>
                      <button class="btn-ghost">REMOVE HEAD ADMIN</button>
                    </form>`
                )
                .join("")
            : `<p class="text-sm text-muted">None assigned yet.</p>`
        }</div>
        <form class="mt-4 grid gap-3 md:grid-cols-2" data-form="HEADADMIN">
          <select name="userId" required><option value="">Registered player</option>${registered.filter((p) => !hasRole(p, "head_admin") && !hasRole(p, "owner")).map((p) => `<option value="${p.id}">${esc(p.name)}${hasRole(p, "admin") ? " · Division Admin" : ""}</option>`).join("")}</select>
          <button class="btn-gold">MAKE HEAD ADMIN</button>
        </form>`, "mt-4")}
      ${panel(`<h2 class="text-lg font-bold">Division Admins</h2>
        <p class="mt-1 text-sm text-muted">Each division lists this person as The Admin for player issues. Head Admins can also be assigned here.</p>
        <div class="mt-3 space-y-2">${
          d.leagueAdmins.length
            ? d.leagueAdmins
                .map(
                  (a) =>
                    `<form class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-2 text-sm" data-form="REVOKE" data-id="${a.id}" data-role="admin" data-league="${a.adminLeagueId || ""}">
                      <span>${esc(a.name)}${hasRole(a, "head_admin") ? " · Head Admin" : ""} · ${esc(a.adminLeagueTitle || "Unassigned")}</span>
                      <button class="btn-ghost">REMOVE ADMIN</button>
                    </form>`
                )
                .join("")
            : `<p class="text-sm text-muted">None assigned yet.</p>`
        }</div>
        <form class="mt-4 grid gap-3 md:grid-cols-3" data-form="ASSIGN">
          <select name="userId" required><option value="">Registered player</option>${registered.map((p) => `<option value="${p.id}">${esc(p.name)}${hasRole(p, "head_admin") ? " · Head Admin" : ""}${hasRole(p, "admin") ? " · Division Admin" : ""}</option>`).join("")}</select>
          <select name="leagueId" required><option value="">League</option>${allLeagueOptions}</select>
          <button class="btn-gold">ASSIGN ADMIN</button>
        </form>`, "mt-4")}`
    : "";
  return layout(
    `<div class="mx-auto max-w-7xl px-4 py-10">
      <h1 class="text-4xl font-extrabold">${d.isOwner ? "Owner desk" : [d.isHeadAdmin ? "Head Admin" : "", hasRole(d.me, "admin") ? "Division Admin" : ""].filter(Boolean).join(" · ") || "Division Admin"}</h1>
      <p class="mt-2 text-muted">${
        d.isOwner
          ? "Promote owners (max 3), assign Head Admins and Division Admins, generate seasons, and run the league."
          : d.isHeadAdmin
            ? "Verify extracted match stats, generate fixtures, and override another admin’s confirmed result when needed."
            : `Confirm results for ${esc(d.leagues[0]?.title || "your league")}.`
      }</p>
      ${state.error ? `<p class="mt-3 text-sm text-red-400">${esc(state.error)}</p>` : ""}
      ${state.notice ? `<p class="mt-3 gold">${esc(state.notice)}</p>` : ""}
      <div class="mt-6 grid gap-4 md:grid-cols-4">
        ${[
          [d.stats.activePlayers, "PLAYERS"],
          [pending.length, "PENDING APPS"],
          [review.length, "TO CONFIRM"],
          [d.fixtures.filter((f) => f.status === "scheduled").length, "OPEN FIXTURES"],
        ]
          .map(([v, l]) => panel(`<div class="text-center"><div class="text-3xl font-extrabold gold">${v}</div><div class="mt-1 text-xs tracking-widest text-muted">${l}</div></div>`))
          .join("")}
      </div>
      ${ownerSection}
      ${panel(`<h2 class="text-lg font-bold">Verify match stats</h2>
        <p class="mt-1 text-sm text-muted">Pick a match. Screenshots are on the left. If the site read numbers from those shots they are pre-filled — check them, then save. Nothing is added to the table until you verify.</p>
        ${statsDesk(review, state.selectedResultId, { formKind: "CONFIRM", buttonLabel: "VERIFY & SAVE TO TABLE", emptyText: "No screenshots waiting." })}`, "mt-6")}
      ${panel(`<h2 class="text-lg font-bold">Pending applications</h2>${
        pending.length
          ? pending
              .map(
                (a) =>
                  `<div class="flex justify-between border-b border-white/10 py-2 text-sm"><span>${esc(a.name)}${a.nickname ? ` “${esc(a.nickname)}”` : ""} · 3DA ${a.avg} · ${esc(a.regionalChoice || a.status)}${a.placedLeagues?.length ? ` · already in ${esc(a.placedLeagues.join(" · "))}` : ""}</span><span class="text-muted">${esc(a.dartcounterName || "")}</span></div>`
              )
              .join("")
          : `<p class="mt-3 text-muted">None yet.</p>`
      }`, "mt-6")}
      ${panel(`<h2 class="text-lg font-bold">Place a player</h2>
        <p class="mt-1 text-sm text-muted">Players who chose Both can be in one Europe league and one Americas league. Placing them in a second regional does not remove the first.</p>
        <form class="mt-3 grid gap-3 md:grid-cols-3" data-form="PLACE">
          <select name="userId" required><option value="">Player</option>${everyone.map(playerOption).join("")}</select>
          <select name="leagueId" required><option value="">League</option>${leagueOptions}</select>
          <button class="btn-gold">PLACE</button>
        </form>`, "mt-4")}
      ${panel(`<h2 class="text-lg font-bold">Generate season fixtures</h2>
        <p class="mt-1 text-sm text-muted">Builds a round-robin so every player in the league meets every other player. Odd numbers get a bye that week. Existing pairings for that season are skipped unless you replace unplayed matches.</p>
        <form class="mt-3 grid gap-3 md:grid-cols-3" data-form="GENERATE">
          <select name="leagueId" required><option value="">League</option>${leagueOptions}</select>
          <input name="season" type="number" min="1" value="1" placeholder="Season">
          <input name="startDate" type="date" value="${new Date().toISOString().slice(0, 10)}">
          <input name="weekGapDays" type="number" min="1" value="7" placeholder="Days between weeks">
          <label class="check-row"><input type="checkbox" name="doubleRound" value="1"> Home and away (double round-robin)</label>
          <label class="check-row"><input type="checkbox" name="replaceScheduled" value="1"> Replace unplayed fixtures this season</label>
          <button class="btn-gold md:col-span-3">GENERATE FIXTURES</button>
        </form>`, "mt-4")}
      ${panel(`<h2 class="text-lg font-bold">Create one fixture</h2>
        <form class="mt-3 grid gap-3 md:grid-cols-5" data-form="FIXTURE">
          <select name="leagueId" required><option value="">League</option>${leagueOptions}</select>
          <input name="week" value="1" placeholder="Week">
          <select name="homeId" required><option value="">Home</option>${everyone.map(playerOption).join("")}</select>
          <select name="awayId" required><option value="">Away</option>${everyone.map(playerOption).join("")}</select>
          <input name="date" type="date">
          <button class="btn-gold md:col-span-5">ADD FIXTURE</button>
        </form>`, "mt-4")}
      ${
        d.canOverride
          ? `${
              d.isOwner
                ? panel(`<h2 class="text-lg font-bold">Owner override</h2>
        <p class="mt-1 text-sm text-muted">Only owners can add, move, or delete players here. Head Admins can override match stats below. This updates the live league immediately — no screenshot and no GitHub PR.</p>
        <h3 class="mt-5 text-sm font-bold tracking-widest gold">ADD PLAYER</h3>
        <form class="mt-3 grid gap-3 md:grid-cols-2" data-form="ADDPLAYER">
          <input name="name" placeholder="Name" required>
          <input name="email" type="email" placeholder="Email" required>
          <input name="username" placeholder="Username (optional)">
          <input name="password" type="text" placeholder="Temporary password" required>
          <input name="dartcounterName" placeholder="DartCounter name">
          <input name="avg" data-numeric="avg" placeholder="3DA">
          <select name="leagueId"><option value="">Unplaced</option>${allLeagueOptions}</select>
          <button class="btn-gold">ADD PLAYER</button>
        </form>
        <h3 class="mt-6 text-sm font-bold tracking-widest gold">REMOVE FROM LEAGUE</h3>
        <form class="mt-3 grid gap-3 md:grid-cols-3" data-form="UNPLACE">
          <select name="userId" required><option value="">Player</option>${everyone.filter((p) => userLeagueIds(p).length).map(playerOption).join("")}</select>
          <select name="leagueId"><option value="">All of their leagues</option>${allLeagueOptions}</select>
          <button class="btn-ghost">UNPLACE</button>
        </form>
        <h3 class="mt-6 text-sm font-bold tracking-widest gold">DELETE PLAYER</h3>
        <p class="mt-1 text-xs text-muted">Deletes the account and their fixtures. Owners cannot be deleted here.</p>
        <form class="mt-3 grid gap-3 md:grid-cols-2" data-form="DELETEPLAYER">
          <select name="userId" required><option value="">Player</option>${everyone.filter((p) => !hasRole(p, "owner")).map(playerOption).join("")}</select>
          <button class="btn-ghost">DELETE</button>
        </form>`, "mt-4")
                : ""
            }
        ${panel(`<h2 class="text-lg font-bold">${d.isOwner ? "Overwrite match stats" : "Override another admin"}</h2>
        <p class="mt-1 text-sm text-muted">${d.isOwner ? "Enter or correct official stats. Tables update as soon as you save. Owners can do this without a screenshot." : "Head Admins can correct or clear a result another admin already confirmed. Tables update as soon as you save."}</p>
        ${statsDesk(d.fixtures, state.selectedResultId, {
          formKind: "OVERRIDE",
          buttonLabel: "SAVE STATS",
          emptyText: "No fixtures yet. Create one above.",
          actions: (f) => `<div class="mt-2 flex gap-2">
            <form data-form="CLEARRESULT" data-id="${f.id}"><button class="btn-ghost">CLEAR RESULT</button></form>
            ${d.isOwner ? `<form data-form="DELETEFIXTURE" data-id="${f.id}"><button class="btn-ghost">DELETE MATCH</button></form>` : ""}
          </div>`,
        })}`, "mt-4")}`
          : ""
      }
      ${
        d.isOwner
          ? panel(`<h2 class="text-lg font-bold">Post announcement</h2>
        <form class="mt-3 space-y-3" data-form="NEWS">
          <input name="title" placeholder="Title" required>
          <textarea name="body" rows="3" placeholder="Body" required></textarea>
          <button class="btn-gold">PUBLISH</button>
        </form>`, "mt-4")
          : ""
      }
    </div>`,
    { arena: true }
  );
}

function matchRoute(path) {
  const q = path.split("?")[0];
  if (q === "/") return ["home"];
  if (q === "/regionals") return ["regionals"];
  let m = q.match(/^\/regionals\/([^/]+)$/);
  if (m) return ["regional", m[1]];
  m = q.match(/^\/regionals\/([^/]+)\/leagues\/(\d+)$/);
  if (m) return ["league", m[1], m[2]];
  if (q === "/apply") return ["apply"];
  if (q === "/sign-in") return ["signin"];
  if (q === "/sign-up") return ["signup"];
  if (q === "/dashboard") return ["dashboard"];
  if (q === "/my-matches") return ["matches"];
  if (q === "/rules") return ["rules"];
  if (q === "/contact") return ["contact"];
  if (q === "/announcements") return ["news"];
  if (q === "/admin") return ["admin"];
  m = q.match(/^\/player\/(\d+)$/);
  if (m) return ["player", m[1]];
  return ["home"];
}

async function render() {
  const app = document.getElementById("app");
  const route = matchRoute(state.path + location.search);
  try {
    if (["dashboard", "matches", "admin"].includes(route[0]) && !state.user) {
      go("/sign-in");
      return;
    }
    if (route[0] === "admin" && !isStaff()) {
      go("/dashboard");
      return;
    }
    const map = {
      home: pageHome,
      regionals: pageRegionals,
      regional: () => pageRegional(route[1]),
      league: () => pageLeague(route[1], route[2]),
      apply: pageApply,
      signin: () => pageSignIn(),
      signup: () => pageSignUp(),
      dashboard: pageDashboard,
      matches: pageMyMatches,
      player: () => pagePlayer(route[1]),
      rules: () => pageRules(),
      contact: () => pageContact(),
      news: pageNews,
      admin: pageAdmin,
    };
    app.innerHTML = await map[route[0]]();
    const fixtureId = new URLSearchParams(location.search).get("fixture");
    if (fixtureId) {
      const el = document.getElementById(`fixture-${fixtureId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (err) {
    app.innerHTML = layout(`<div class="px-6 py-20 text-center"><p class="gold">${esc(err.message)}</p></div>`, { arena: true });
  }
}

document.addEventListener("click", async (e) => {
  const toggle = e.target.closest("[data-act=toggle-password]");
  if (toggle) {
    e.preventDefault();
    const wrap = toggle.closest(".password-wrap");
    const input = wrap?.querySelector("input");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    return;
  }
  const pick = e.target.closest("[data-act=pick-result]");
  if (pick) {
    e.preventDefault();
    state.selectedResultId = Number(pick.dataset.id);
    render();
    return;
  }
  const a = e.target.closest("a");
  if (a && a.href && a.origin === location.origin && !a.hasAttribute("download")) {
    e.preventDefault();
    go(a.pathname + a.search);
    return;
  }
  if (e.target.closest("[data-act=open-menu]")) {
    state.menu = true;
    render();
  }
  if (e.target.closest("[data-act=close-menu]")) {
    state.menu = false;
    render();
  }
  if (e.target.closest("[data-act=logout]")) {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {}
    clearToken();
    state.user = null;
    go("/");
  }
  const faq = e.target.closest("[data-faq]");
  if (faq) {
    const body = faq.querySelector(".faq-a");
    if (body) body.classList.toggle("hidden");
  }
  const regionBtn = e.target.closest("[data-act=signup-region]");
  if (regionBtn) {
    state.signup.regional = regionBtn.dataset.region;
    state.error = "";
    render();
  }
  if (e.target.closest("[data-act=signup-back]")) {
    const form = e.target.closest("form");
    if (form) Object.assign(state.signup, Object.fromEntries(new FormData(form).entries()));
    state.signup.step = Math.max(1, (state.signup.step || 1) - 1);
    state.error = "";
    render();
  }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.numeric === "avg") {
    e.target.value = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form).entries());
  const kind = form.dataset.form;
  try {
    if (kind === "SIGN IN") {
      const remember = form.querySelector('input[name="remember"]')?.checked === true;
      const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ ...fd, remember }) });
      storeToken(d.token, remember || d.remember === true);
      state.user = d.user;
      go(isStaff(d.user) ? "/admin" : "/dashboard");
    } else if (kind === "SIGNUP") {
      Object.assign(state.signup, fd);
      const step = Number(form.dataset.step || state.signup.step || 1);
      if (step === 2 && !state.signup.regional) {
        state.error = "Choose TSH Europe, TSH Americas, or Both.";
        render();
        return;
      }
      if (step === 5) {
        const avg = String(state.signup.avg || "").replace(/[^0-9.]/g, "");
        if (!avg) {
          state.error = "Enter your 3DA using numbers.";
          render();
          return;
        }
        state.signup.avg = avg;
        const d = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify(state.signup),
        });
        storeToken(d.token, true);
        state.user = d.user;
        state.signup = { step: 1, name: "", email: "", password: "", regional: "", dartcounterName: "", nickname: "", avg: "" };
        go("/dashboard");
      } else {
        state.signup.step = step + 1;
        state.error = "";
        render();
      }
    } else if (kind === "CREATE ACCOUNT") {
      const d = await api("/api/auth/register", { method: "POST", body: JSON.stringify(fd) });
      storeToken(d.token, true);
      state.user = d.user;
      go("/apply");
    } else if (kind === "APPLY" || kind === "SUBMIT APPLICATION" || kind === "SIGN UP TO APPLY") {
      if (!state.user) return go("/sign-up");
      await api("/api/apply", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Application received. An admin will place you in a division.";
      render();
    } else if (kind === "UPLOAD") {
      const file = form.querySelector('input[type="file"]')?.files?.[0];
      if (!file) throw new Error("Choose a screenshot");
      const image = await fileToDataUrl(file);
      const d = await api(`/api/my-fixtures/${form.dataset.id}/screenshot`, { method: "POST", body: JSON.stringify({ image, slot: Number(form.dataset.slot) || undefined }) });
      if (d.fixture?.hasBothScreenshots) {
        state.notice = "Both screenshots uploaded. Reading stats for admin review…";
        render();
        try {
          const extracted = await ocrFixtureStats(d.fixture, [image]);
          if (extracted) {
            await api(`/api/my-fixtures/${form.dataset.id}/extracted-stats`, { method: "POST", body: JSON.stringify(extracted) });
            state.notice = "Stats extracted from the screenshots. A division admin will verify them before they count.";
          } else {
            state.notice = "Both screenshots uploaded. Could not auto-read the stats — a division admin will enter them.";
          }
        } catch {
          state.notice = "Both screenshots uploaded. A division admin will verify the stats.";
        }
      } else {
        state.notice = "Screenshot uploaded. Upload the second screenshot for this match.";
      }
      render();
    } else if (kind === "SCANSTATS") {
      state.selectedResultId = Number(form.dataset.id);
      state.notice = "Scanning screenshots…";
      render();
      const overview = await api("/api/admin/overview");
      const fixture = overview.fixtures.find((f) => f.id === Number(form.dataset.id));
      if (!fixture) throw new Error("Fixture not found");
      const extracted = await ocrFixtureStats(fixture);
      if (!extracted) throw new Error("Could not read numbers from those screenshots. Enter the stats by hand.");
      await api(`/api/my-fixtures/${form.dataset.id}/extracted-stats`, { method: "POST", body: JSON.stringify(extracted) });
      state.selectedResultId = fixture.id;
      state.notice = "Stats extracted. Check every number, then verify to add them to the table.";
      render();
    } else if (kind === "PROPOSE") {
      await api(`/api/fixtures/${form.dataset.id}/propose`, { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Date and time proposed. Your opponent can accept it on the Fixtures tab.";
      render();
    } else if (kind === "ACCEPTTIME") {
      await api(`/api/fixtures/${form.dataset.id}/accept-time`, { method: "POST", body: "{}" });
      state.notice = "Kickoff time agreed.";
      render();
    } else if (kind === "GENERATE") {
      const d = await api("/api/admin/fixtures/generate", { method: "POST", body: JSON.stringify(fd) });
      state.notice = `Generated ${d.created} fixture${d.created === 1 ? "" : "s"} across ${d.weeks} week${d.weeks === 1 ? "" : "s"}${d.skipped ? ` (${d.skipped} already existed)` : ""}.`;
      render();
    } else if (kind === "HEADADMIN") {
      await api("/api/admin/assign-head-admin", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Head Admin assigned.";
      render();
    } else if (kind === "CONFIRM") {
      await api(`/api/admin/fixtures/${form.dataset.id}/result`, { method: "POST", body: JSON.stringify(fd) });
      state.selectedResultId = null;
      state.notice = "Verified. League table updated.";
      render();
    } else if (kind === "ASSIGN") {
      await api("/api/admin/assign-admin", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Division Admin assigned.";
      render();
    } else if (kind === "OWNER") {
      await api("/api/admin/assign-owner", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Owner added.";
      render();
    } else if (kind === "REVOKE" || kind === "REMOVE ADMIN") {
      await api("/api/admin/revoke-admin", { method: "POST", body: JSON.stringify({ userId: form.dataset.id, role: form.dataset.role, leagueId: form.dataset.league }) });
      state.notice = form.dataset.role === "head_admin" ? "Head Admin role removed. Other roles were kept." : "Division Admin role removed for that league. Other roles were kept.";
      render();
    } else if (kind === "PROFILE") {
      const d = await api("/api/account/profile", { method: "POST", body: JSON.stringify(fd) });
      state.user = d.user;
      state.notice = "Profile saved.";
      render();
    } else if (kind === "ACCOUNT") {
      const d = await api("/api/account", { method: "POST", body: JSON.stringify(fd) });
      state.user = d.user;
      state.notice = "Account saved.";
      render();
    } else if (kind === "AVATAR") {
      const file = form.querySelector('input[type="file"]')?.files?.[0];
      if (!file) throw new Error("Choose a photo");
      const image = await fileToAvatarDataUrl(file);
      const d = await api("/api/account/avatar", { method: "POST", body: JSON.stringify({ image }) });
      state.user = d.user;
      state.notice = "Profile picture updated.";
      render();
    } else if (kind === "SAVE" || kind === "RESULT") {
      throw new Error("Players upload a screenshot. Admins enter the official score.");
    } else if (kind === "PLACE") {
      const d = await api("/api/admin/place-player", { method: "POST", body: JSON.stringify(fd) });
      const titles = d.user?.leagueTitles || [];
      state.notice =
        d.user?.regionalChoice === "both" && !d.fullyPlaced
          ? `Placed in ${titles[titles.length - 1] || "that league"}. They can still be placed in the other regional.`
          : "Player placed.";
      render();
    } else if (kind === "ADD FIXTURE" || kind === "FIXTURE") {
      await api("/api/admin/fixtures", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Fixture created.";
      render();
    } else if (kind === "ADDPLAYER") {
      await api("/api/admin/create-player", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Player added.";
      render();
    } else if (kind === "UNPLACE") {
      await api("/api/admin/unplace-player", { method: "POST", body: JSON.stringify(fd) });
      state.notice = fd.leagueId ? "Player removed from that league." : "Player removed from their leagues.";
      render();
    } else if (kind === "DELETEPLAYER") {
      if (!window.confirm("Delete this player and all of their matches? This cannot be undone.")) return;
      await api("/api/admin/delete-player", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Player deleted.";
      render();
    } else if (kind === "OVERRIDE" || kind === "SAVE STATS") {
      await api(`/api/admin/fixtures/${form.dataset.id}/result`, { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Match stats saved. Table updated.";
      render();
    } else if (kind === "CLEARRESULT") {
      await api(`/api/admin/fixtures/${form.dataset.id}/clear`, { method: "POST", body: "{}" });
      state.notice = "Result cleared.";
      render();
    } else if (kind === "DELETEFIXTURE") {
      if (!window.confirm("Delete this match?")) return;
      await api(`/api/admin/fixtures/${form.dataset.id}/delete`, { method: "POST", body: "{}" });
      state.notice = "Match deleted.";
      render();
    } else if (kind === "PUBLISH" || kind === "NEWS") {
      await api("/api/admin/announcements", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Announcement posted.";
      render();
    }
  } catch (err) {
    state.error = err.message;
    render();
  }
});

async function boot() {
  const hadJsToken = Boolean(token());
  const remembered = wantsRemember() || Boolean((() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return "";
    }
  })());
  try {
    const d = await api("/api/auth/me");
    state.user = d.user;
    if (d.token) storeToken(d.token, remembered || !hadJsToken);
  } catch {
    if (hadJsToken) clearToken();
  }
  render();
}
boot();
