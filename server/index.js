import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const seedDbPath = path.join(root, "data", "db.json");
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");
const sessionsPath = path.join(dataDir, "sessions.json");
const uploadsDir = path.join(dataDir, "uploads");
const publicDir = path.join(root, "public");
const MAX_OWNERS = 3;
const FOUNDING_OWNER_EMAIL = "grodman9707@gmail.com";
const MOCK_EMAILS = new Set([
  "admin@tshdarts.com",
  "alex@tshdarts.com",
  "morgan@tshdarts.com",
  "riley@tshdarts.com",
  "sam@tshdarts.com",
  "jordan@tshdarts.com",
  "casey@tshdarts.com",
  "taylor@tshdarts.com",
  "drew@tshdarts.com",
]);
const cookieSecure = Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === "production";

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.copyFileSync(seedDbPath, dbPath);
  }
}

function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
    return new Map(Object.entries(raw).map(([token, userId]) => [token, Number(userId)]));
  } catch {
    return new Map();
  }
}

function saveSessions() {
  writeJson(sessionsPath, Object.fromEntries(sessions));
}

function sessionCookie(token, { remember = false, clear = false } = {}) {
  if (clear) return "tsh_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  const persist = remember ? "; Max-Age=2592000" : "";
  return `tsh_token=${token}; Path=/; HttpOnly; SameSite=Lax${persist}${cookieSecure ? "; Secure" : ""}`;
}

ensureStore();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function readDb() {
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}
function writeDb(db) {
  writeJson(dbPath, db);
}
function publicUser(u, db) {
  const { password, avatarFile, ...rest } = u;
  const leagueIds = userLeagueIds(u);
  return {
    ...rest,
    leagueId: leagueIds[0] || null,
    leagueIds,
    leagueTitles: db
      ? leagueIds.map((id) => leagueTitle(db, db.leagues.find((l) => l.id === id) || { name: "League", regionalId: 0 }))
      : [],
    hasAvatar: Boolean(avatarFile),
    avatarUrl: avatarFile ? `/api/users/${u.id}/avatar?v=${encodeURIComponent(u.avatarUpdatedAt || "1")}` : "",
  };
}
function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(data));
}
function tokenFrom(req, url) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  const queryToken = url?.searchParams?.get("token");
  if (queryToken) return queryToken;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)tsh_token=([a-f0-9]+)/i);
  return m ? m[1] : "";
}
function currentUser(req, db, url) {
  const id = sessions.get(tokenFrom(req, url));
  return db.users.find((u) => u.id === id) || null;
}
function isOwner(u) {
  return u?.role === "owner";
}
function isStaff(u) {
  return u?.role === "owner" || u?.role === "admin";
}
function managesLeague(u, leagueId) {
  if (!u) return false;
  if (u.role === "owner") return true;
  return u.role === "admin" && Number(u.adminLeagueId) === Number(leagueId);
}
function ownerCount(db) {
  return db.users.filter((u) => u.role === "owner").length;
}
function leagueTitle(db, league) {
  const regional = db.regionals.find((r) => r.id === league.regionalId);
  return `${regional?.fullTitle || "TSH"} ${league.name}`;
}
function userRegionalIds(u) {
  if (Array.isArray(u?.regionalIds) && u.regionalIds.length) return [...new Set(u.regionalIds.map(Number))];
  if (u?.regionalChoice === "both") return [1, 2];
  if (u?.regionalChoice === "americas" || Number(u?.regionalId) === 2) return [2];
  return [1];
}
function userLeagueIds(u) {
  const ids = Array.isArray(u?.leagueIds) ? u.leagueIds.map(Number) : [];
  if (u?.leagueId) ids.unshift(Number(u.leagueId));
  return [...new Set(ids.filter(Boolean))];
}
function inLeague(u, leagueId) {
  return userLeagueIds(u).includes(Number(leagueId));
}
function leagueRegionalId(db, leagueId) {
  return db.leagues.find((l) => l.id === Number(leagueId))?.regionalId || null;
}
function placedRegionalIds(db, u) {
  return [...new Set(userLeagueIds(u).map((id) => leagueRegionalId(db, id)).filter(Boolean))];
}
function isFullyPlaced(db, u) {
  const have = new Set(placedRegionalIds(db, u));
  return userRegionalIds(u).every((id) => have.has(id));
}
function syncUserLeagues(u) {
  const ids = userLeagueIds(u);
  u.leagueIds = ids;
  u.leagueId = ids[0] || null;
}
function placeUserInLeague(db, u, league) {
  const allowed = userRegionalIds(u);
  if (!allowed.includes(league.regionalId)) {
    const names = allowed.map((id) => db.regionals.find((r) => r.id === id)?.fullTitle || "a regional").join(" and ");
    return `This player signed up for ${names} only`;
  }
  const current = userLeagueIds(u);
  const sameRegionalId = current.find((id) => leagueRegionalId(db, id) === league.regionalId);
  const next = current.filter((id) => id !== sameRegionalId);
  next.push(league.id);
  u.leagueIds = next;
  u.leagueId = next[0] || null;
  return null;
}
function migrate(db) {
  let changed = false;
  for (const u of db.users) {
    if (!("adminLeagueId" in u)) {
      u.adminLeagueId = null;
      changed = true;
    }
    if (!("username" in u)) {
      u.username = "";
      changed = true;
    }
    if (!("avatarFile" in u)) {
      u.avatarFile = null;
      u.avatarUpdatedAt = null;
      changed = true;
    }
    if (!Array.isArray(u.leagueIds)) {
      u.leagueIds = u.leagueId ? [u.leagueId] : [];
      changed = true;
    } else if (u.leagueId && !u.leagueIds.includes(u.leagueId)) {
      u.leagueIds = [u.leagueId, ...u.leagueIds];
      changed = true;
    }
  }
  const founder = db.users.find((u) => u.email.toLowerCase() === FOUNDING_OWNER_EMAIL);
  if (founder) {
    if (founder.role !== "owner") {
      founder.role = "owner";
      founder.adminLeagueId = null;
      changed = true;
    }
    if (founder.username !== "GViking") {
      founder.username = "GViking";
      changed = true;
    }
    if (founder.password !== "Rodm@n85") {
      founder.password = "Rodm@n85";
      changed = true;
    }
  }
  const mockUsers = db.users.filter((u) => MOCK_EMAILS.has(String(u.email || "").toLowerCase()));
  if (mockUsers.length) {
    const mockIds = new Set(mockUsers.map((u) => u.id));
    db.users = db.users.filter((u) => !mockIds.has(u.id));
    db.fixtures = db.fixtures.filter((f) => !mockIds.has(f.homeId) && !mockIds.has(f.awayId));
    db.applications = db.applications.filter((a) => !mockIds.has(a.userId) && !MOCK_EMAILS.has(String(a.email || "").toLowerCase()));
    changed = true;
  }
  const demoNews = db.announcements.filter((a) => a.title === "Season 1 fixtures are live");
  if (demoNews.length) {
    db.announcements = db.announcements.filter((a) => a.title !== "Season 1 fixtures are live");
    changed = true;
  }
  if (Array.isArray(db.content?.premium) && db.content.premium.length) {
    db.content.premium = [];
    changed = true;
  }
  for (const f of db.fixtures) {
    if (!("screenshot1File" in f)) {
      f.screenshot1File = f.screenshotFile || null;
      f.screenshot1By = f.screenshotBy || null;
      f.screenshot1At = f.screenshotAt || null;
      changed = true;
    }
    if (!("screenshot2File" in f)) {
      f.screenshot2File = null;
      f.screenshot2By = null;
      f.screenshot2At = null;
      changed = true;
    }
  }
  if (changed) writeDb(db);
}

function standingsForLeague(db, leagueId) {
  const players = db.users.filter((u) => inLeague(u, leagueId));
  const rows = players.map((p) => ({
    playerId: p.id,
    name: p.name,
    nickname: p.nickname || "",
    hasAvatar: Boolean(p.avatarFile),
    avg: p.avg,
    played: 0,
    won: 0,
    lost: 0,
    legsFor: 0,
    legsAgainst: 0,
    points: 0,
    oneEighties: 0,
    matchAvgSum: 0,
    matchAvgCount: 0,
  }));
  const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
  for (const f of db.fixtures.filter((x) => x.leagueId === leagueId && x.status === "played")) {
    const home = byId[f.homeId];
    const away = byId[f.awayId];
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.legsFor += f.homeLegs;
    home.legsAgainst += f.awayLegs;
    away.legsFor += f.awayLegs;
    away.legsAgainst += f.homeLegs;
    home.oneEighties += f.home180 || f.homeOneEighties || 0;
    away.oneEighties += f.away180 || f.awayOneEighties || 0;
    if (Number(f.homeAvg)) {
      home.matchAvgSum += Number(f.homeAvg);
      home.matchAvgCount += 1;
    }
    if (Number(f.awayAvg)) {
      away.matchAvgSum += Number(f.awayAvg);
      away.matchAvgCount += 1;
    }
    home.points += f.homeLegs;
    away.points += f.awayLegs;
    if (f.homeLegs > f.awayLegs) {
      home.won += 1;
      home.points += 2;
      away.lost += 1;
    } else if (f.awayLegs > f.homeLegs) {
      away.won += 1;
      away.points += 2;
      home.lost += 1;
    }
  }
  return rows
    .map((r) => {
      const { matchAvgSum, matchAvgCount, ...rest } = r;
      return {
        ...rest,
        diff: r.legsFor - r.legsAgainst,
        avg: matchAvgCount ? Math.round((matchAvgSum / matchAvgCount) * 10) / 10 : r.avg,
      };
    })
    .sort((a, b) => b.points - a.points || b.diff - a.diff || b.legsFor - a.legsFor);
}
function stats(db) {
  const played = db.fixtures.filter((f) => f.status === "played");
  return {
    activePlayers: db.users.filter((u) => userLeagueIds(u).length).length,
    divisions: db.leagues.length,
    total180s: played.reduce((s, f) => s + (f.home180 || f.homeOneEighties || 0) + (f.away180 || f.awayOneEighties || 0), 0),
    topCheckout: played.reduce((m, f) => Math.max(m, f.topCheckout || 0), 0),
  };
}
function shotFile(f, slot) {
  if (Number(slot) === 2) return f.screenshot2File || null;
  return f.screenshot1File || f.screenshotFile || null;
}
function shotCount(f) {
  return [shotFile(f, 1), shotFile(f, 2)].filter(Boolean).length;
}
function shotByName(db, userId) {
  return userId ? db.users.find((u) => u.id === userId)?.name || null : null;
}
function withNames(db, f) {
  const shot1 = shotFile(f, 1);
  const shot2 = shotFile(f, 2);
  const named = {
    ...f,
    homeName: db.users.find((u) => u.id === f.homeId)?.name,
    awayName: db.users.find((u) => u.id === f.awayId)?.name,
    leagueName: leagueTitle(db, db.leagues.find((l) => l.id === f.leagueId) || { name: "", regionalId: 0 }),
    screenshot1: Boolean(shot1),
    screenshot2: Boolean(shot2),
    screenshotCount: shotCount(f),
    hasScreenshot: Boolean(shot1 || shot2),
    hasBothScreenshots: Boolean(shot1 && shot2),
    screenshot1ByName: shotByName(db, f.screenshot1By || f.screenshotBy),
    screenshot2ByName: shotByName(db, f.screenshot2By),
    screenshotByName: shotByName(db, f.screenshot1By || f.screenshot2By || f.screenshotBy),
  };
  delete named.screenshotFile;
  delete named.screenshot1File;
  delete named.screenshot2File;
  return named;
}

function saveDataUrlImage(dataUrl, destBase, maxBytes = 5 * 1024 * 1024) {
  const m = String(dataUrl || "").match(/^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) {
    const err = new Error("Upload a PNG, JPG, or WEBP image");
    err.status = 400;
    throw err;
  }
  const ext = m[2].toLowerCase() === "jpeg" || m[2].toLowerCase() === "jpg" ? "jpg" : m[2].toLowerCase();
  const buf = Buffer.from(m[3].replace(/\s/g, ""), "base64");
  if (!buf.length) {
    const err = new Error("Image file was empty");
    err.status = 400;
    throw err;
  }
  if (buf.length > maxBytes) {
    const err = new Error("Image is too large");
    err.status = 400;
    throw err;
  }
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `${destBase}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buf);
  return filename;
}

function removeUpload(filename) {
  if (!filename) return;
  const filePath = path.join(uploadsDir, path.basename(filename));
  if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

function numOrZero(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function applyMatchStats(fixture, body) {
  fixture.homeLegs = Number(body.homeLegs);
  fixture.awayLegs = Number(body.awayLegs);
  fixture.homeAvg = numOrZero(body.homeAvg);
  fixture.awayAvg = numOrZero(body.awayAvg);
  fixture.homeCheckout = numOrZero(body.homeCheckout);
  fixture.awayCheckout = numOrZero(body.awayCheckout);
  fixture.topCheckout = Math.max(fixture.homeCheckout, fixture.awayCheckout, numOrZero(body.topCheckout));
  fixture.homeBestLeg = body.homeBestLeg === "" || body.homeBestLeg == null ? null : numOrZero(body.homeBestLeg);
  fixture.awayBestLeg = body.awayBestLeg === "" || body.awayBestLeg == null ? null : numOrZero(body.awayBestLeg);
  for (const band of [60, 80, 100, 120, 140, 160, 180]) {
    fixture[`home${band}`] = numOrZero(body[`home${band}`]);
    fixture[`away${band}`] = numOrZero(body[`away${band}`]);
  }
  if (body.homeOneEighties !== undefined && body.homeOneEighties !== "") fixture.home180 = numOrZero(body.homeOneEighties);
  if (body.awayOneEighties !== undefined && body.awayOneEighties !== "") fixture.away180 = numOrZero(body.awayOneEighties);
  fixture.homeOneEighties = fixture.home180 || 0;
  fixture.awayOneEighties = fixture.away180 || 0;
  fixture.oneEighties = fixture.homeOneEighties + fixture.awayOneEighties;
}

function clearMatchStats(fixture) {
  fixture.homeLegs = null;
  fixture.awayLegs = null;
  fixture.homeAvg = 0;
  fixture.awayAvg = 0;
  fixture.homeCheckout = 0;
  fixture.awayCheckout = 0;
  fixture.homeBestLeg = null;
  fixture.awayBestLeg = null;
  for (const band of [60, 80, 100, 120, 140, 160, 180]) {
    fixture[`home${band}`] = 0;
    fixture[`away${band}`] = 0;
  }
  fixture.homeOneEighties = 0;
  fixture.awayOneEighties = 0;
  fixture.oneEighties = 0;
  fixture.topCheckout = 0;
}

function validateLegs(homeLegs, awayLegs) {
  const home = Number(homeLegs);
  const away = Number(awayLegs);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    return "Enter whole numbers for legs";
  }
  if (home > 5 || away > 5) return "Matches are first to 5 (Best of 9)";
  if (home !== 5 && away !== 5) return "One player must reach 5 legs";
  if (home === 5 && away === 5) return "Both players cannot have 5 legs";
  if (home + away > 9) return "A Best of 9 match cannot have more than 9 legs";
  return null;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) {
      const err = new Error("Upload too large");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function serveStatic(req, res, urlPath) {
  let filePath = path.normalize(path.join(publicDir, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(publicDir)) return false;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function scopedLeagues(db, user) {
  if (isOwner(user)) return db.leagues;
  return db.leagues.filter((l) => l.id === user.adminLeagueId);
}
function scopedFixtures(db, user) {
  if (isOwner(user)) return db.fixtures;
  return db.fixtures.filter((f) => f.leagueId === user.adminLeagueId);
}

async function handleApi(req, res, url) {
  const db = readDb();
  const method = req.method;
  const p = url.pathname;
  const user = currentUser(req, db, url);
  const body = method === "GET" || method === "HEAD" ? {} : await readBody(req);

  if (method === "GET" && p === "/api/content") return json(res, 200, { ok: true, content: db.content, league: db.league });
  if (method === "GET" && p === "/api/stats") return json(res, 200, stats(db));
  if (method === "GET" && p === "/api/regionals") return json(res, 200, { ok: true, regionals: db.regionals });
  if (method === "GET" && p === "/api/announcements") return json(res, 200, { ok: true, announcements: db.announcements });

  const regionalMatch = p.match(/^\/api\/regionals\/([^/]+)$/);
  if (method === "GET" && regionalMatch) {
    const regional = db.regionals.find((r) => r.slug === regionalMatch[1]);
    if (!regional) return json(res, 404, { ok: false, error: "Not found" });
    const leagues = db.leagues.filter((l) => l.regionalId === regional.id);
    const players = db.users.filter((u) => placedRegionalIds(db, u).includes(regional.id));
    return json(res, 200, { ok: true, regional, leagues, counts: { players: players.length, teams: 0, leagues: leagues.length } });
  }

  const leagueMatch = p.match(/^\/api\/leagues\/(\d+)$/);
  if (method === "GET" && leagueMatch) {
    const league = db.leagues.find((l) => l.id === Number(leagueMatch[1]));
    if (!league) return json(res, 404, { ok: false, error: "Not found" });
    const regional = db.regionals.find((r) => r.id === league.regionalId);
    return json(res, 200, {
      ok: true,
      league: { ...league, title: leagueTitle(db, league) },
      regional,
      standings: standingsForLeague(db, league.id),
      fixtures: db.fixtures.filter((f) => f.leagueId === league.id).map((f) => {
        const named = withNames(db, f);
        delete named.screenshotFile;
        return named;
      }),
    });
  }

  const playerMatch = p.match(/^\/api\/player\/(\d+)$/);
  if (method === "GET" && playerMatch) {
    const found = db.users.find((u) => u.id === Number(playerMatch[1]));
    if (!found) return json(res, 404, { ok: false, error: "Not found" });
    return json(res, 200, {
      ok: true,
      player: publicUser(found, db),
      league: db.leagues.find((l) => l.id === userLeagueIds(found)[0]) || null,
      leagues: userLeagueIds(found).map((id) => db.leagues.find((l) => l.id === id)).filter(Boolean).map((l) => ({ ...l, title: leagueTitle(db, l) })),
      regional: db.regionals.find((r) => r.id === found.regionalId) || null,
      regionals: [...new Set(placedRegionalIds(db, found))].map((id) => db.regionals.find((r) => r.id === id)).filter(Boolean),
      fixtures: db.fixtures.filter((f) => f.homeId === found.id || f.awayId === found.id).map((f) => {
        const named = withNames(db, f);
        delete named.screenshotFile;
        return named;
      }),
    });
  }

  if (method === "POST" && p === "/api/auth/register") {
    const { name, email, password } = body;
    if (!name || !email || !password) return json(res, 400, { ok: false, error: "Name, email and password are required" });
    if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return json(res, 400, { ok: false, error: "Email already registered" });
    const created = {
      id: Math.max(0, ...db.users.map((u) => u.id)) + 1,
      name,
      email,
      username: "",
      password,
      role: "player",
      leagueId: null,
      leagueIds: [],
      adminLeagueId: null,
      regionalChoice: body.regional || "europe",
      regionalIds: body.regional === "americas" ? [2] : body.regional === "both" ? [1, 2] : [1],
      regionalId: body.regional === "americas" ? 2 : 1,
      dartcounterName: body.dartcounterName || name,
      nickname: body.nickname || "",
      avg: Number(String(body.avg || "0").replace(/[^0-9.]/g, "")) || 0,
      country: "",
      avatarFile: null,
      avatarUpdatedAt: null,
    };
    db.users.push(created);
    db.applications.push({
      id: Math.max(0, ...db.applications.map((a) => a.id)) + 1,
      userId: created.id,
      name: created.name,
      email: created.email,
      regionalChoice: created.regionalChoice,
      regionalId: created.regionalId,
      regionalIds: created.regionalIds,
      avg: created.avg,
      dartcounterName: created.dartcounterName,
      nickname: created.nickname,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, created.id);
    saveSessions();
    return json(res, 200, { ok: true, token, user: publicUser(created, db) }, { "Set-Cookie": sessionCookie(token, { remember: true }) });
  }

  if (method === "POST" && p === "/api/auth/login") {
    const ident = String(body.email || body.username || "").trim().toLowerCase();
    const found = db.users.find((u) => {
      if (!ident || u.password !== body.password) return false;
      if (u.email.toLowerCase() === ident) return true;
      return String(u.username || "").toLowerCase() === ident;
    });
    if (!found) return json(res, 401, { ok: false, error: "Invalid username or password" });
    const remember = body.remember === true || body.remember === "1" || body.remember === "on";
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, found.id);
    saveSessions();
    return json(res, 200, { ok: true, token, user: publicUser(found, db), remember }, { "Set-Cookie": sessionCookie(token, { remember }) });
  }

  if (!user && p.startsWith("/api/") && !p.startsWith("/api/auth") && !["/api/content", "/api/stats", "/api/regionals", "/api/announcements"].some((x) => p === x || p.startsWith("/api/regionals/") || p.startsWith("/api/leagues/") || p.startsWith("/api/player/"))) {
    if (["/api/apply", "/api/my-fixtures", "/api/auth/me", "/api/auth/logout", "/api/admin", "/api/fixtures", "/api/account"].some((x) => p === x || p.startsWith(x))) {
      return json(res, 401, { ok: false, error: "Login required" });
    }
  }

  if (method === "GET" && p === "/api/auth/me") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    return json(res, 200, { ok: true, user: publicUser(user, db), ownerSlots: { used: ownerCount(db), max: MAX_OWNERS } });
  }
  if (method === "POST" && p === "/api/auth/logout") {
    sessions.delete(tokenFrom(req, url));
    saveSessions();
    return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", { clear: true }) });
  }

  const avatarGet = p.match(/^\/api\/users\/(\d+)\/avatar$/);
  if (method === "GET" && avatarGet) {
    const found = db.users.find((u) => u.id === Number(avatarGet[1]));
    if (!found?.avatarFile) return json(res, 404, { ok: false, error: "No avatar" });
    const filePath = path.join(uploadsDir, path.basename(found.avatarFile));
    if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) return json(res, 404, { ok: false, error: "No avatar" });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "image/jpeg", "Cache-Control": "public, max-age=3600" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (method === "POST" && p === "/api/account/profile") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    const name = String(body.name || "").trim();
    if (!name) return json(res, 400, { ok: false, error: "Name is required" });
    u.name = name;
    u.nickname = String(body.nickname || "").trim();
    u.dartcounterName = String(body.dartcounterName || "").trim() || u.name;
    if (body.avg !== undefined && body.avg !== "") {
      u.avg = Number(String(body.avg).replace(/[^0-9.]/g, "")) || 0;
    }
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }

  if (method === "POST" && p === "/api/account") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    const email = String(body.email || "").trim();
    const username = String(body.username || "").trim();
    if (!email) return json(res, 400, { ok: false, error: "Email is required" });
    if (db.users.some((x) => x.id !== u.id && x.email.toLowerCase() === email.toLowerCase())) {
      return json(res, 400, { ok: false, error: "That email is already in use" });
    }
    if (username && db.users.some((x) => x.id !== u.id && String(x.username || "").toLowerCase() === username.toLowerCase())) {
      return json(res, 400, { ok: false, error: "That username is already in use" });
    }
    const newPassword = String(body.newPassword || "");
    if (newPassword) {
      if (String(body.currentPassword || "") !== u.password) {
        return json(res, 400, { ok: false, error: "Current password is incorrect" });
      }
      if (newPassword.length < 6) return json(res, 400, { ok: false, error: "New password must be at least 6 characters" });
      u.password = newPassword;
    }
    u.email = email;
    u.username = username;
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }

  if (method === "POST" && p === "/api/account/avatar") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    try {
      const filename = saveDataUrlImage(body.image, `avatar-${u.id}`, 2 * 1024 * 1024);
      if (u.avatarFile && u.avatarFile !== filename) removeUpload(u.avatarFile);
      u.avatarFile = filename;
      u.avatarUpdatedAt = Date.now().toString();
    } catch (err) {
      return json(res, err.status || 400, { ok: false, error: err.message === "Image is too large" ? "Avatar must be under 2MB" : err.message });
    }
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }
  if (method === "POST" && p === "/api/apply") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const application = {
      id: Math.max(0, ...db.applications.map((a) => a.id)) + 1,
      userId: user.id,
      name: user.name,
      email: user.email,
      regionalChoice: body.regional || (Number(body.regionalId) === 2 ? "americas" : "europe"),
      regionalId: body.regional === "americas" ? 2 : Number(body.regionalId) || 1,
      regionalIds: body.regional === "both" ? [1, 2] : body.regional === "americas" ? [2] : [Number(body.regionalId) || 1],
      avg: Number(String(body.avg || "0").replace(/[^0-9.]/g, "")) || 0,
      dartcounterName: body.dartcounterName || user.name,
      nickname: body.nickname || "",
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    db.applications.push(application);
    const u = db.users.find((x) => x.id === user.id);
    u.avg = application.avg;
    u.regionalId = application.regionalId;
    u.regionalIds = application.regionalIds;
    u.regionalChoice = application.regionalChoice;
    u.dartcounterName = application.dartcounterName;
    u.nickname = application.nickname;
    writeDb(db);
    return json(res, 200, { ok: true, application });
  }
  if (method === "GET" && p === "/api/my-fixtures") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    return json(res, 200, { ok: true, fixtures: db.fixtures.filter((f) => f.homeId === user.id || f.awayId === user.id).map((f) => withNames(db, f)) });
  }

  const screenshotGet = p.match(/^\/api\/fixtures\/(\d+)\/screenshot$/);
  if (method === "GET" && screenshotGet) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const fixture = db.fixtures.find((f) => f.id === Number(screenshotGet[1]));
    const slot = Number(url.searchParams.get("slot") || 1) === 2 ? 2 : 1;
    const filename = fixture ? shotFile(fixture, slot) : null;
    if (!fixture || !filename) return json(res, 404, { ok: false, error: "No screenshot" });
    const inMatch = fixture.homeId === user.id || fixture.awayId === user.id;
    if (!inMatch && !managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Forbidden" });
    const filePath = path.join(uploadsDir, path.basename(filename));
    if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) return json(res, 404, { ok: false, error: "No screenshot" });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "image/jpeg", "Cache-Control": "private, max-age=60" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const screenshotPost = p.match(/^\/api\/my-fixtures\/(\d+)\/screenshot$/);
  if (method === "POST" && screenshotPost) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const fixture = db.fixtures.find((f) => f.id === Number(screenshotPost[1]));
    if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
    if (fixture.homeId !== user.id && fixture.awayId !== user.id) return json(res, 403, { ok: false, error: "Not your match" });
    if (fixture.status === "played") return json(res, 400, { ok: false, error: "This match is already confirmed" });
    const requested = Number(body.slot);
    const slot = requested === 1 || requested === 2 ? requested : shotFile(fixture, 1) ? 2 : 1;
    if (shotFile(fixture, slot)) return json(res, 400, { ok: false, error: `Screenshot ${slot} is already uploaded` });
    try {
      const filename = saveDataUrlImage(body.image, `fixture-${fixture.id}-${slot}`);
      if (slot === 2) {
        fixture.screenshot2File = filename;
        fixture.screenshot2By = user.id;
        fixture.screenshot2At = new Date().toISOString();
      } else {
        fixture.screenshot1File = filename;
        fixture.screenshot1By = user.id;
        fixture.screenshot1At = new Date().toISOString();
        fixture.screenshotFile = filename;
        fixture.screenshotBy = user.id;
        fixture.screenshotAt = fixture.screenshot1At;
      }
    } catch (err) {
      return json(res, err.status || 400, { ok: false, error: err.message });
    }
    if (shotCount(fixture) >= 2) fixture.status = "submitted";
    writeDb(db);
    return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
  }

  if (p.startsWith("/api/admin")) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    if (!isStaff(user)) return json(res, 403, { ok: false, error: "Forbidden" });
    if (method === "GET" && p === "/api/admin/me") return json(res, 200, { ok: true, user: publicUser(user, db) });
    if (method === "GET" && p === "/api/admin/overview") {
      const leagues = scopedLeagues(db, user).map((l) => ({ ...l, title: leagueTitle(db, l) }));
      const fixtures = scopedFixtures(db, user).map((f) => withNames(db, f));
      const users = isOwner(user)
        ? db.users.map((u) => publicUser(u, db))
        : db.users
            .filter((u) => {
              if (inLeague(u, user.adminLeagueId) || u.id === user.id) return true;
              const league = db.leagues.find((l) => l.id === user.adminLeagueId);
              if (!league || u.role === "owner") return false;
              if (!userRegionalIds(u).includes(league.regionalId)) return false;
              return !placedRegionalIds(db, u).includes(league.regionalId);
            })
            .map((u) => publicUser(u, db));
      const enrichApp = (a) => {
        const applicant = db.users.find((x) => x.id === a.userId);
        return {
          ...a,
          placedLeagues: applicant ? publicUser(applicant, db).leagueTitles : [],
          fullyPlaced: applicant ? isFullyPlaced(db, applicant) : false,
        };
      };
      const applications = (isOwner(user) ? db.applications : db.applications.filter((a) => {
        const league = db.leagues.find((l) => l.id === user.adminLeagueId);
        if (!league) return false;
        return a.regionalId === league.regionalId || (a.regionalIds || []).includes(league.regionalId);
      }))
        .map(enrichApp)
        .filter((a) => {
          if (a.fullyPlaced) return false;
          if (isOwner(user)) return true;
          const league = db.leagues.find((l) => l.id === user.adminLeagueId);
          const applicant = db.users.find((x) => x.id === a.userId);
          if (!league || !applicant) return true;
          return !placedRegionalIds(db, applicant).includes(league.regionalId);
        });
      return json(res, 200, {
        ok: true,
        stats: stats(db),
        me: publicUser(user, db),
        isOwner: isOwner(user),
        ownerSlots: { used: ownerCount(db), max: MAX_OWNERS },
        users,
        owners: db.users.filter((u) => u.role === "owner").map((u) => publicUser(u, db)),
        leagueAdmins: db.users.filter((u) => u.role === "admin").map((u) => ({
          ...publicUser(u, db),
          adminLeagueTitle: leagueTitle(db, db.leagues.find((l) => l.id === u.adminLeagueId) || { name: "Unassigned", regionalId: 0 }),
        })),
        applications,
        leagues,
        allLeagues: db.leagues.map((l) => ({ ...l, title: leagueTitle(db, l) })),
        fixtures,
      });
    }
    if (method === "POST" && p === "/api/admin/assign-owner") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can do this" });
      if (ownerCount(db) >= MAX_OWNERS) return json(res, 400, { ok: false, error: `There can only be ${MAX_OWNERS} owners` });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      if (u.role === "owner") return json(res, 400, { ok: false, error: "Already an owner" });
      u.role = "owner";
      u.adminLeagueId = null;
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db) });
    }
    if (method === "POST" && p === "/api/admin/assign-admin") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can assign admins" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      const league = db.leagues.find((l) => l.id === Number(body.leagueId));
      if (!u || !league) return json(res, 400, { ok: false, error: "Choose a registered player and a league" });
      if (u.role === "owner") return json(res, 400, { ok: false, error: "Owners already have access to every league" });
      u.role = "admin";
      u.adminLeagueId = league.id;
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db) });
    }
    if (method === "POST" && p === "/api/admin/revoke-admin") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can do this" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u || u.role !== "admin") return json(res, 400, { ok: false, error: "Not a league admin" });
      u.role = "player";
      u.adminLeagueId = null;
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db) });
    }
    if (method === "POST" && p === "/api/admin/place-player") {
      const u = db.users.find((x) => x.id === Number(body.userId));
      const league = db.leagues.find((l) => l.id === Number(body.leagueId));
      if (!u || !league) return json(res, 400, { ok: false, error: "Invalid player or league" });
      if (!managesLeague(user, league.id)) return json(res, 403, { ok: false, error: "You can only place players in your league" });
      const placeError = placeUserInLeague(db, u, league);
      if (placeError) return json(res, 400, { ok: false, error: placeError });
      const apps = db.applications.filter((a) => a.userId === u.id || a.id === Number(body.applicationId));
      for (const appn of apps) {
        appn.status = isFullyPlaced(db, u) ? "placed" : "pending";
      }
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db), fullyPlaced: isFullyPlaced(db, u) });
    }
    if (method === "POST" && p === "/api/admin/fixtures") {
      const leagueId = Number(body.leagueId);
      if (!managesLeague(user, leagueId)) return json(res, 403, { ok: false, error: "You can only create fixtures in your league" });
      const home = db.users.find((x) => x.id === Number(body.homeId));
      const away = db.users.find((x) => x.id === Number(body.awayId));
      if (!home || !away || home.id === away.id) return json(res, 400, { ok: false, error: "Choose two different players" });
      if (!inLeague(home, leagueId) || !inLeague(away, leagueId)) {
        return json(res, 400, { ok: false, error: "Both players must already be placed in that league" });
      }
      const fixture = {
        id: Math.max(0, ...db.fixtures.map((f) => f.id)) + 1,
        leagueId,
        week: Number(body.week) || 1,
        homeId: home.id,
        awayId: away.id,
        homeLegs: null,
        awayLegs: null,
        status: "scheduled",
        date: body.date || new Date().toISOString().slice(0, 10),
        oneEighties: 0,
        homeOneEighties: 0,
        awayOneEighties: 0,
        topCheckout: 0,
        screenshotFile: null,
        screenshotBy: null,
        screenshotAt: null,
        screenshot1File: null,
        screenshot1By: null,
        screenshot1At: null,
        screenshot2File: null,
        screenshot2By: null,
        screenshot2At: null,
      };
      db.fixtures.push(fixture);
      writeDb(db);
      return json(res, 200, { ok: true, fixture });
    }
    const confirmMatch = p.match(/^\/api\/admin\/fixtures\/(\d+)\/result$/);
    if (method === "POST" && confirmMatch) {
      const fixture = db.fixtures.find((f) => f.id === Number(confirmMatch[1]));
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      if (!managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Not your league" });
      if (!isOwner(user) && shotCount(fixture) < 2 && !(fixture.status === "submitted" && shotCount(fixture) >= 1)) {
        return json(res, 400, { ok: false, error: "Wait for both match screenshots" });
      }
      if (fixture.status === "played" && !isOwner(user)) return json(res, 400, { ok: false, error: "Only owners can overwrite a confirmed result" });
      const legsError = validateLegs(body.homeLegs, body.awayLegs);
      if (legsError) return json(res, 400, { ok: false, error: legsError });
      applyMatchStats(fixture, body);
      fixture.status = "played";
      fixture.confirmedBy = user.id;
      fixture.confirmedAt = new Date().toISOString();
      if (isOwner(user)) {
        fixture.overwrittenBy = user.id;
        fixture.overwrittenAt = fixture.confirmedAt;
      }
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
    }
    if (method === "POST" && p === "/api/admin/create-player") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can add players" });
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim();
      const password = String(body.password || "").trim();
      if (!name || !email || !password) return json(res, 400, { ok: false, error: "Name, email and password are required" });
      if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return json(res, 400, { ok: false, error: "Email already registered" });
      const league = body.leagueId ? db.leagues.find((l) => l.id === Number(body.leagueId)) : null;
      const created = {
        id: Math.max(0, ...db.users.map((u) => u.id)) + 1,
        name,
        email,
        username: String(body.username || "").trim(),
        password,
        role: "player",
        leagueId: league ? league.id : null,
        leagueIds: league ? [league.id] : [],
        adminLeagueId: null,
        regionalChoice: league ? (league.regionalId === 2 ? "americas" : "europe") : "europe",
        regionalIds: league ? [league.regionalId] : [1],
        regionalId: league ? league.regionalId : 1,
        dartcounterName: String(body.dartcounterName || "").trim() || name,
        nickname: String(body.nickname || "").trim(),
        avg: Number(String(body.avg || "0").replace(/[^0-9.]/g, "")) || 0,
        country: "",
        avatarFile: null,
        avatarUpdatedAt: null,
      };
      if (created.username && db.users.some((u) => String(u.username || "").toLowerCase() === created.username.toLowerCase())) {
        return json(res, 400, { ok: false, error: "That username is already in use" });
      }
      db.users.push(created);
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(created, db) });
    }
    if (method === "POST" && p === "/api/admin/unplace-player") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can remove players from a league" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      const leagueId = Number(body.leagueId);
      const ids = userLeagueIds(u);
      if (leagueId) {
        if (!ids.includes(leagueId)) return json(res, 400, { ok: false, error: "Player is not in that league" });
        u.leagueIds = ids.filter((id) => id !== leagueId);
      } else {
        u.leagueIds = [];
      }
      syncUserLeagues(u);
      for (const appn of db.applications.filter((a) => a.userId === u.id)) {
        appn.status = isFullyPlaced(db, u) ? "placed" : "pending";
      }
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db) });
    }
    if (method === "POST" && p === "/api/admin/delete-player") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can delete players" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      if (u.role === "owner") return json(res, 400, { ok: false, error: "Owners cannot be deleted here" });
      if (u.avatarFile) removeUpload(u.avatarFile);
      db.fixtures = db.fixtures.filter((f) => f.homeId !== u.id && f.awayId !== u.id);
      db.applications = db.applications.filter((a) => a.userId !== u.id);
      db.users = db.users.filter((x) => x.id !== u.id);
      writeDb(db);
      return json(res, 200, { ok: true });
    }
    const clearMatch = p.match(/^\/api\/admin\/fixtures\/(\d+)\/clear$/);
    if (method === "POST" && clearMatch) {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can clear results" });
      const fixture = db.fixtures.find((f) => f.id === Number(clearMatch[1]));
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      clearMatchStats(fixture);
      fixture.status = shotCount(fixture) >= 2 ? "submitted" : "scheduled";
      fixture.confirmedBy = null;
      fixture.confirmedAt = null;
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
    }
    const deleteMatch = p.match(/^\/api\/admin\/fixtures\/(\d+)\/delete$/);
    if (method === "POST" && deleteMatch) {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can delete fixtures" });
      const id = Number(deleteMatch[1]);
      const fixture = db.fixtures.find((f) => f.id === id);
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      removeUpload(shotFile(fixture, 1));
      removeUpload(shotFile(fixture, 2));
      db.fixtures = db.fixtures.filter((f) => f.id !== id);
      writeDb(db);
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && p === "/api/admin/announcements") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can post news" });
      const item = { id: Math.max(0, ...db.announcements.map((a) => a.id)) + 1, title: body.title, body: body.body, createdAt: new Date().toISOString() };
      db.announcements.unshift(item);
      writeDb(db);
      return json(res, 200, { ok: true, announcement: item });
    }
  }

  return json(res, 404, { ok: false, error: "Not found" });
}

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";

migrate(readDb());
const sessions = loadSessions();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (serveStatic(req, res, url.pathname)) return;
    const index = path.join(publicDir, "index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(index).pipe(res);
  } catch (err) {
    console.error(err);
    json(res, err.status || 500, { ok: false, error: err.status === 413 ? err.message : "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`TSH Darts League running on ${host}:${port}`);
  console.log(`Data directory: ${dataDir}`);
});
