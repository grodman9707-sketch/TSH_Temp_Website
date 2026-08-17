const TOKEN_KEY = "tsh_token";
const $ = (sel, el = document) => el.querySelector(sel);

const state = {
  path: location.pathname,
  user: null,
  menu: false,
  data: {},
  error: "",
  notice: "",
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
  return localStorage.getItem(TOKEN_KEY) || "";
}
function isStaff(u = state.user) {
  return u?.role === "owner" || u?.role === "admin";
}
function screenshotUrl(id) {
  return `/api/fixtures/${id}/screenshot?token=${encodeURIComponent(token())}`;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read screenshot"));
    reader.readAsDataURL(file);
  });
}
function fixtureStatus(f) {
  if (f.status === "played") return `<div class="text-2xl font-extrabold gold">${f.homeLegs} – ${f.awayLegs}</div>`;
  if (f.status === "submitted" || f.hasScreenshot) return `<div class="text-xs font-bold tracking-widest gold">AWAITING ADMIN</div>`;
  return `<div class="text-xs font-bold tracking-widest text-red-500">SCHEDULED</div>`;
}
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(path, { ...options, headers });
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
    <div class="${home ? "arena-bg min-h-screen" : "min-h-screen bg-background"}">
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
                ? `<a href="/dashboard" class="btn-gold">${esc(state.user.name.split(" ")[0].toUpperCase())}</a>`
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
  const [stats, content, regionals] = await Promise.all([api("/api/stats"), api("/api/content"), api("/api/regionals")]);
  let ticker = [];
  for (const r of regionals.regionals) {
    const detail = await api(`/api/regionals/${r.slug}`);
    for (const league of detail.leagues) {
      const table = await api(`/api/leagues/${league.id}`);
      for (const f of table.fixtures.filter((x) => x.status === "played").slice(0, 2)) {
        ticker.push({ div: league.name.toUpperCase(), text: `${f.homeName} vs ${f.awayName} — ${f.homeLegs}-${f.awayLegs}`, live: false });
      }
      for (const f of table.fixtures.filter((x) => x.status === "scheduled").slice(0, 1)) {
        ticker.push({ div: league.name.toUpperCase(), text: `${f.homeName} vs ${f.awayName}`, live: true });
      }
    }
  }
  if (!ticker.length) ticker = [{ div: "LEAGUE 1", text: "Season 1 is live — apply now", live: true }];
  const loop = [...ticker, ...ticker];
  const faq = content.content.faq || [];
  const premium = content.content.premium || [];
  return layout(
    `
    <section class="relative flex min-h-[calc(100vh-3.5rem)] flex-col justify-end pb-24 pt-10">
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        <img src="${CRESTS.main}" alt="The Social Hub" class="crest-hero">
      </div>
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
          <h3 class="text-lg font-bold">Player Premium</h3>
          <ul class="mt-3 space-y-1 text-sm text-muted">${premium.map((p) => `<li>• ${esc(p)}</li>`).join("")}</ul>
          <div class="mt-4 flex gap-3"><a href="/apply" class="btn-gold">GET PREMIUM</a><a href="/rules" class="btn-ghost">Rules</a></div>
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
              `<a href="/regionals/${slug}/leagues/${l.id}" class="glass flex items-center justify-between rounded-xl px-5 py-4"><div><div class="font-bold">${esc(l.name)}</div><div class="text-sm text-muted">${esc(l.format)}</div></div><span class="text-xs font-semibold tracking-widest gold">TABLE</span></a>`
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
      <div class="mt-4 flex gap-2">
        <a href="/regionals/${slug}/leagues/${id}" class="${tab === "table" ? "btn-gold" : "btn-ghost"}">TABLE</a>
        <a href="/regionals/${slug}/leagues/${id}?tab=fixtures" class="${tab === "fixtures" ? "btn-gold" : "btn-ghost"}">FIXTURES</a>
      </div>
      ${
        tab === "fixtures"
          ? `<div class="mt-4 space-y-3">${d.fixtures
              .map(
                (f) =>
                  panel(`<div class="flex flex-wrap items-center justify-between gap-3"><div><div class="text-xs uppercase tracking-widest text-muted">Week ${f.week} · ${esc(f.date)}</div><div class="mt-1 font-semibold">${esc(f.homeName)} vs ${esc(f.awayName)}</div></div><div>${fixtureStatus(f)}</div></div>`)
              )
              .join("")}</div>`
          : `<div class="glass table-wrap mt-4 rounded-xl"><table><thead><tr>${["#", "Player", "P", "W", "L", "LF", "LA", "+/-", "Pts", "Avg"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${d.standings
              .map(
                (row, i) =>
                  `<tr><td class="gold">${i + 1}</td><td><a href="/player/${row.playerId}">${esc(row.name)}</a></td><td>${row.played}</td><td>${row.won}</td><td>${row.lost}</td><td>${row.legsFor}</td><td>${row.legsAgainst}</td><td>${row.diff}</td><td class="gold font-bold">${row.points}</td><td>${Number(row.avg).toFixed(1)}</td></tr>`
              )
              .join("")}</tbody></table></div>`
      }
    </div>`,
    { arena: true }
  );
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
     <input name="password" type="password" placeholder="Password" required autocomplete="current-password">`,
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
      <input name="password" type="password" value="${esc(s.password)}" placeholder="Password" required autocomplete="new-password">
    `;
  } else if (step === 2) {
    const opt = (key, title, img, note) => `
      <button type="button" class="region-card ${s.regional === key ? "selected" : ""}" data-act="signup-region" data-region="${key}">
        <img src="${img}" alt="${title}" class="mx-auto" style="width:108px;height:108px;object-fit:contain">
        <div class="mt-3 font-bold">${title}</div>
        <div class="mt-1 text-xs text-muted">${note}</div>
      </button>`;
    body = `
      <p class="text-sm text-muted">Choose where you want to compete.</p>
      <div class="grid gap-3">
        ${opt("europe", "TSH Europe", CRESTS.europe, "United Kingdom & Europe")}
        ${opt("americas", "TSH Americas", CRESTS.americas, "North & South America")}
        ${opt("both", "Both", CRESTS.main, "Play in Europe and the Americas")}
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
  const next = d.fixtures.find((f) => f.status === "scheduled");
  const played = d.fixtures.filter((f) => f.status === "played");
  return layout(
    `<div class="mx-auto max-w-4xl px-4 py-10">
      <p class="text-xs font-semibold tracking-[0.3em] gold">PLAYER HUB</p>
      <h1 class="mt-2 text-4xl font-extrabold">${esc(state.user.nickname || state.user.name)}</h1>
      <p class="mt-2 text-muted">${state.user.dartcounterName ? `DartCounter: ${esc(state.user.dartcounterName)} · ` : ""}${state.user.avg ? `3DA ${esc(state.user.avg)}` : "Application pending"}</p>
      <div class="mt-6 grid gap-4 md:grid-cols-3">
        ${panel(`<div class="text-xs tracking-widest text-muted">NEXT MATCH</div><div class="mt-2 font-semibold">${next ? `${esc(next.homeName)} vs ${esc(next.awayName)}` : "None scheduled"}</div>`)}
        ${panel(`<div class="text-xs tracking-widest text-muted">RESULTS IN</div><div class="mt-2 text-3xl font-extrabold gold">${played.length}</div>`)}
        ${panel(`<div class="text-xs tracking-widest text-muted">AWAITING ADMIN</div><div class="mt-2 text-3xl font-extrabold gold">${d.fixtures.filter((f) => f.status === "submitted").length}</div>`)}
      </div>
      <a href="/my-matches" class="mt-6 inline-block text-sm font-bold tracking-widest gold">OPEN MY MATCHES →</a>
    </div>`,
    { arena: true }
  );
}
async function pageMyMatches() {
  const d = await api("/api/my-fixtures");
  return layout(
    `<div class="mx-auto max-w-3xl px-4 py-10">
      <h1 class="text-3xl font-extrabold">My Matches</h1>
      <p class="mt-2 text-sm text-muted">Play on DartCounter. One player from the fixture uploads a screenshot. A league admin then enters the official score.</p>
      ${state.error ? `<p class="mt-3 text-sm text-red-400">${esc(state.error)}</p>` : ""}
      ${state.notice ? `<p class="mt-3 text-sm gold">${esc(state.notice)}</p>` : ""}
      <div class="mt-6 space-y-3">
        ${d.fixtures
          .map((f) => {
            let action = fixtureStatus(f);
            if (f.status === "scheduled") {
              action = `<form class="space-y-2" data-form="UPLOAD" data-id="${f.id}">
                <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" required>
                <button class="btn-gold w-full">UPLOAD SCREENSHOT</button>
              </form>`;
            } else if (f.status === "submitted") {
              action = `<div class="text-right"><div class="text-xs font-bold tracking-widest gold">SCREENSHOT IN</div><div class="mt-1 text-xs text-muted">Uploaded by ${esc(f.screenshotByName || "a player")}. Waiting on admin to confirm stats.</div></div>`;
            }
            return panel(`<div class="grid gap-3 md:grid-cols-[1fr_220px] md:items-center">
                <div><div class="text-xs uppercase tracking-widest text-muted">${esc(f.leagueName)} · Week ${f.week} · ${esc(f.date)}</div>
                <div class="mt-1 text-lg font-semibold">${esc(f.homeName)} vs ${esc(f.awayName)}</div></div>
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
      ${panel(`<p class="text-xs tracking-[0.3em] gold">${esc(d.regional?.fullTitle || "Unplaced")}</p>
        <h1 class="mt-2 text-4xl font-extrabold">${esc(d.player.name)}</h1>
        <p class="mt-2 text-muted">${esc(d.league?.name || "Awaiting division")} · Avg ${esc(d.player.avg)}</p>`)}
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
          <li>Every match is Best of 9 (first to 5 legs).</li>
          <li>1 point per leg won, plus 2 extra points for the match win.</li>
          <li>Example: win 5–3 and you score 7 points; your opponent scores 3.</li>
        </ul>
        <h2 class="text-lg font-bold text-white">Results</h2>
        <p>One player from the fixture uploads a DartCounter screenshot. League admins check the screenshot and enter the official legs, 180s, and checkout for the table.</p>
        <h2 class="text-lg font-bold text-white">Scheduling</h2>
        <p>Arrange a time, play on DartCounter, then upload the screenshot from My Matches. Owners place players and assign league admins.</p>
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
  const registered = d.users.filter((u) => u.role === "player" || u.role === "admin");
  const pending = d.applications.filter((a) => a.status === "pending");
  const review = d.fixtures.filter((f) => f.status === "submitted");
  const leagueOptions = d.leagues.map((l) => `<option value="${l.id}">${esc(l.title || l.name)}</option>`).join("");
  const allLeagueOptions = (d.allLeagues || d.leagues).map((l) => `<option value="${l.id}">${esc(l.title || l.name)}</option>`).join("");
  const ownerSection = d.isOwner
    ? `${panel(`<h2 class="text-lg font-bold">Owners (${d.ownerSlots.used}/${d.ownerSlots.max})</h2>
        <p class="mt-1 text-sm text-muted">Only these ${d.ownerSlots.max} people can make someone a league admin.</p>
        <div class="mt-3 space-y-2">${d.owners.map((o) => `<div class="text-sm">${esc(o.name)} · ${esc(o.email)}</div>`).join("")}</div>
        ${
          d.ownerSlots.used < d.ownerSlots.max
            ? `<form class="mt-4 grid gap-3 md:grid-cols-2" data-form="OWNER">
                <select name="userId" required><option value="">Registered player</option>${registered.filter((p) => p.role !== "owner").map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.email)}</option>`).join("")}</select>
                <button class="btn-gold">MAKE OWNER</button>
              </form>`
            : `<p class="mt-3 text-sm text-muted">All three owner slots are filled.</p>`
        }`, "mt-6")}
      ${panel(`<h2 class="text-lg font-bold">League admins</h2>
        <p class="mt-1 text-sm text-muted">Assign a registered player as admin of one league. They can view screenshots and enter official stats for that league.</p>
        <div class="mt-3 space-y-2">${
          d.leagueAdmins.length
            ? d.leagueAdmins
                .map(
                  (a) =>
                    `<form class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-2 text-sm" data-form="REVOKE" data-id="${a.id}">
                      <span>${esc(a.name)} · ${esc(a.adminLeagueTitle || "Unassigned")}</span>
                      <button class="btn-ghost">REMOVE ADMIN</button>
                    </form>`
                )
                .join("")
            : `<p class="text-sm text-muted">None assigned yet.</p>`
        }</div>
        <form class="mt-4 grid gap-3 md:grid-cols-3" data-form="ASSIGN">
          <select name="userId" required><option value="">Registered player</option>${registered.filter((p) => p.role === "player").map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
          <select name="leagueId" required><option value="">League</option>${allLeagueOptions}</select>
          <button class="btn-gold">ASSIGN ADMIN</button>
        </form>`, "mt-4")}`
    : "";
  return layout(
    `<div class="mx-auto max-w-5xl px-4 py-10">
      <h1 class="text-4xl font-extrabold">${d.isOwner ? "Owner desk" : "League admin"}</h1>
      <p class="mt-2 text-muted">${d.isOwner ? "Promote owners (max 3), assign league admins, and run the league." : `Confirm results for ${esc(d.leagues[0]?.title || "your league")}.`}</p>
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
      ${panel(`<h2 class="text-lg font-bold">Results to confirm</h2>
        <p class="mt-1 text-sm text-muted">Check the screenshot, then enter legs (first to 5), 180s, and highest checkout. Points: 1 per leg won + 2 for the match win.</p>
        ${
          review.length
            ? review
                .map(
                  (f) =>
                    `<div class="mt-4 border-t border-white/10 pt-4">
                      <div class="text-xs uppercase tracking-widest text-muted">${esc(f.leagueName)} · Week ${f.week}</div>
                      <div class="mt-1 font-semibold">${esc(f.homeName)} vs ${esc(f.awayName)}</div>
                      <p class="mt-1 text-xs text-muted">Screenshot by ${esc(f.screenshotByName || "a player")}</p>
                      <img class="result-shot mt-3" src="${screenshotUrl(f.id)}" alt="Match screenshot">
                      <form class="mt-3 grid gap-2 md:grid-cols-6" data-form="CONFIRM" data-id="${f.id}">
                        <input name="homeLegs" type="number" min="0" max="5" placeholder="${esc(f.homeName)} legs" required>
                        <input name="awayLegs" type="number" min="0" max="5" placeholder="${esc(f.awayName)} legs" required>
                        <input name="homeOneEighties" type="number" min="0" placeholder="${esc(f.homeName)} 180s">
                        <input name="awayOneEighties" type="number" min="0" placeholder="${esc(f.awayName)} 180s">
                        <input name="topCheckout" type="number" min="0" max="170" placeholder="Top checkout">
                        <button class="btn-gold">CONFIRM</button>
                      </form>
                    </div>`
                )
                .join("")
            : `<p class="mt-3 text-muted">No screenshots waiting.</p>`
        }`, "mt-6")}
      ${panel(`<h2 class="text-lg font-bold">Pending applications</h2>${
        pending.length
          ? pending
              .map(
                (a) =>
                  `<div class="flex justify-between border-b border-white/10 py-2 text-sm"><span>${esc(a.name)}${a.nickname ? ` “${esc(a.nickname)}”` : ""} · 3DA ${a.avg} · ${esc(a.regionalChoice || a.status)}</span><span class="text-muted">${esc(a.dartcounterName || "")}</span></div>`
              )
              .join("")
          : `<p class="mt-3 text-muted">None yet.</p>`
      }`, "mt-6")}
      ${panel(`<h2 class="text-lg font-bold">Place a player</h2>
        <form class="mt-3 grid gap-3 md:grid-cols-3" data-form="PLACE">
          <select name="userId" required><option value="">Player</option>${registered.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
          <select name="leagueId" required><option value="">League</option>${leagueOptions}</select>
          <button class="btn-gold">PLACE</button>
        </form>`, "mt-4")}
      ${panel(`<h2 class="text-lg font-bold">Create fixture</h2>
        <form class="mt-3 grid gap-3 md:grid-cols-5" data-form="FIXTURE">
          <select name="leagueId" required><option value="">League</option>${leagueOptions}</select>
          <input name="week" value="1" placeholder="Week">
          <select name="homeId" required><option value="">Home</option>${registered.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
          <select name="awayId" required><option value="">Away</option>${registered.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
          <input name="date" type="date">
          <button class="btn-gold md:col-span-5">ADD FIXTURE</button>
        </form>`, "mt-4")}
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
  } catch (err) {
    app.innerHTML = layout(`<div class="px-6 py-20 text-center"><p class="gold">${esc(err.message)}</p></div>`, { arena: true });
  }
}

document.addEventListener("click", async (e) => {
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
    localStorage.removeItem(TOKEN_KEY);
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
      const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify(fd) });
      localStorage.setItem(TOKEN_KEY, d.token);
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
        localStorage.setItem(TOKEN_KEY, d.token);
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
      localStorage.setItem(TOKEN_KEY, d.token);
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
      await api(`/api/my-fixtures/${form.dataset.id}/screenshot`, { method: "POST", body: JSON.stringify({ image }) });
      state.notice = "Screenshot uploaded. A league admin will enter the official score.";
      render();
    } else if (kind === "CONFIRM") {
      await api(`/api/admin/fixtures/${form.dataset.id}/result`, { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Result confirmed. Table updated.";
      render();
    } else if (kind === "ASSIGN") {
      await api("/api/admin/assign-admin", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "League admin assigned.";
      render();
    } else if (kind === "OWNER") {
      await api("/api/admin/assign-owner", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Owner added.";
      render();
    } else if (kind === "REVOKE" || kind === "REMOVE ADMIN") {
      await api("/api/admin/revoke-admin", { method: "POST", body: JSON.stringify({ userId: form.dataset.id }) });
      state.notice = "Admin access removed.";
      render();
    } else if (kind === "SAVE" || kind === "RESULT") {
      throw new Error("Players upload a screenshot. Admins enter the official score.");
    } else if (kind === "PLACE") {
      await api("/api/admin/place-player", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Player placed.";
      render();
    } else if (kind === "ADD FIXTURE" || kind === "FIXTURE") {
      await api("/api/admin/fixtures", { method: "POST", body: JSON.stringify(fd) });
      state.notice = "Fixture created.";
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
  if (token()) {
    try {
      const d = await api("/api/auth/me");
      state.user = d.user;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  render();
}
boot();
