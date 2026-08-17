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

function sessionCookie(token, clear = false) {
  if (clear) return "tsh_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  return `tsh_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${cookieSecure ? "; Secure" : ""}`;
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
function publicUser(u) {
  const { password, ...rest } = u;
  return rest;
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
function migrate(db) {
  let changed = false;
  for (const u of db.users) {
    if (!("adminLeagueId" in u)) {
      u.adminLeagueId = null;
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
    if (!("screenshotFile" in f)) {
      f.screenshotFile = null;
      f.screenshotBy = null;
      f.screenshotAt = null;
      changed = true;
    }
  }
  if (changed) writeDb(db);
}

function standingsForLeague(db, leagueId) {
  const players = db.users.filter((u) => u.leagueId === leagueId);
  const rows = players.map((p) => ({
    playerId: p.id,
    name: p.name,
    avg: p.avg,
    played: 0,
    won: 0,
    lost: 0,
    legsFor: 0,
    legsAgainst: 0,
    points: 0,
    oneEighties: 0,
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
    home.oneEighties += f.homeOneEighties || 0;
    away.oneEighties += f.awayOneEighties || 0;
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
  return rows.map((r) => ({ ...r, diff: r.legsFor - r.legsAgainst })).sort((a, b) => b.points - a.points || b.diff - a.diff || b.legsFor - a.legsFor);
}
function stats(db) {
  const played = db.fixtures.filter((f) => f.status === "played");
  return {
    activePlayers: db.users.filter((u) => u.leagueId).length,
    divisions: db.leagues.length,
    total180s: played.reduce((s, f) => s + (f.oneEighties || 0) + (f.homeOneEighties || 0) + (f.awayOneEighties || 0), 0),
    topCheckout: played.reduce((m, f) => Math.max(m, f.topCheckout || 0), 0),
  };
}
function withNames(db, f) {
  return {
    ...f,
    homeName: db.users.find((u) => u.id === f.homeId)?.name,
    awayName: db.users.find((u) => u.id === f.awayId)?.name,
    leagueName: leagueTitle(db, db.leagues.find((l) => l.id === f.leagueId) || { name: "", regionalId: 0 }),
    hasScreenshot: Boolean(f.screenshotFile),
    screenshotByName: f.screenshotBy ? db.users.find((u) => u.id === f.screenshotBy)?.name : null,
  };
}

function saveDataUrlImage(dataUrl, destBase) {
  const m = String(dataUrl || "").match(/^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) {
    const err = new Error("Upload a PNG, JPG, or WEBP screenshot");
    err.status = 400;
    throw err;
  }
  const ext = m[2].toLowerCase() === "jpeg" || m[2].toLowerCase() === "jpg" ? "jpg" : m[2].toLowerCase();
  const buf = Buffer.from(m[3].replace(/\s/g, ""), "base64");
  if (!buf.length) {
    const err = new Error("Screenshot file was empty");
    err.status = 400;
    throw err;
  }
  if (buf.length > 5 * 1024 * 1024) {
    const err = new Error("Screenshot must be under 5MB");
    err.status = 400;
    throw err;
  }
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `${destBase}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buf);
  return filename;
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
    const players = db.users.filter((u) => u.regionalId === regional.id && u.leagueId);
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
      player: publicUser(found),
      league: db.leagues.find((l) => l.id === found.leagueId) || null,
      regional: db.regionals.find((r) => r.id === found.regionalId) || null,
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
      password,
      role: "player",
      leagueId: null,
      adminLeagueId: null,
      regionalChoice: body.regional || "europe",
      regionalIds: body.regional === "americas" ? [2] : body.regional === "both" ? [1, 2] : [1],
      regionalId: body.regional === "americas" ? 2 : 1,
      dartcounterName: body.dartcounterName || name,
      nickname: body.nickname || "",
      avg: Number(String(body.avg || "0").replace(/[^0-9.]/g, "")) || 0,
      country: "",
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
    return json(res, 200, { ok: true, token, user: publicUser(created) }, { "Set-Cookie": sessionCookie(token) });
  }

  if (method === "POST" && p === "/api/auth/login") {
    const ident = String(body.email || body.username || "").trim().toLowerCase();
    const found = db.users.find((u) => {
      if (!ident || u.password !== body.password) return false;
      if (u.email.toLowerCase() === ident) return true;
      return String(u.username || "").toLowerCase() === ident;
    });
    if (!found) return json(res, 401, { ok: false, error: "Invalid username or password" });
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, found.id);
    saveSessions();
    return json(res, 200, { ok: true, token, user: publicUser(found) }, { "Set-Cookie": sessionCookie(token) });
  }

  if (!user && p.startsWith("/api/") && !p.startsWith("/api/auth") && !["/api/content", "/api/stats", "/api/regionals", "/api/announcements"].some((x) => p === x || p.startsWith("/api/regionals/") || p.startsWith("/api/leagues/") || p.startsWith("/api/player/"))) {
    if (["/api/apply", "/api/my-fixtures", "/api/auth/me", "/api/auth/logout", "/api/admin", "/api/fixtures"].some((x) => p === x || p.startsWith(x))) {
      return json(res, 401, { ok: false, error: "Login required" });
    }
  }

  if (method === "GET" && p === "/api/auth/me") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    return json(res, 200, { ok: true, user: publicUser(user), ownerSlots: { used: ownerCount(db), max: MAX_OWNERS } });
  }
  if (method === "POST" && p === "/api/auth/logout") {
    sessions.delete(tokenFrom(req, url));
    saveSessions();
    return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", true) });
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
    if (!fixture || !fixture.screenshotFile) return json(res, 404, { ok: false, error: "No screenshot" });
    const inMatch = fixture.homeId === user.id || fixture.awayId === user.id;
    if (!inMatch && !managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Forbidden" });
    const filePath = path.join(uploadsDir, path.basename(fixture.screenshotFile));
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
    if (fixture.screenshotFile) return json(res, 400, { ok: false, error: "A screenshot is already uploaded for this match" });
    try {
      fixture.screenshotFile = saveDataUrlImage(body.image, `fixture-${fixture.id}`);
    } catch (err) {
      return json(res, err.status || 400, { ok: false, error: err.message });
    }
    fixture.screenshotBy = user.id;
    fixture.screenshotAt = new Date().toISOString();
    fixture.status = "submitted";
    writeDb(db);
    return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
  }

  if (p.startsWith("/api/admin")) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    if (!isStaff(user)) return json(res, 403, { ok: false, error: "Forbidden" });
    if (method === "GET" && p === "/api/admin/me") return json(res, 200, { ok: true, user: publicUser(user) });
    if (method === "GET" && p === "/api/admin/overview") {
      const leagues = scopedLeagues(db, user).map((l) => ({ ...l, title: leagueTitle(db, l) }));
      const fixtures = scopedFixtures(db, user).map((f) => withNames(db, f));
      const users = isOwner(user)
        ? db.users.map(publicUser)
        : db.users
            .filter((u) => {
              if (u.leagueId === user.adminLeagueId || u.id === user.id) return true;
              const league = db.leagues.find((l) => l.id === user.adminLeagueId);
              if (!league || u.role === "owner") return false;
              return !u.leagueId && (u.regionalId === league.regionalId || (u.regionalIds || []).includes(league.regionalId));
            })
            .map(publicUser);
      return json(res, 200, {
        ok: true,
        stats: stats(db),
        me: publicUser(user),
        isOwner: isOwner(user),
        ownerSlots: { used: ownerCount(db), max: MAX_OWNERS },
        users,
        owners: db.users.filter((u) => u.role === "owner").map(publicUser),
        leagueAdmins: db.users.filter((u) => u.role === "admin").map((u) => ({
          ...publicUser(u),
          adminLeagueTitle: leagueTitle(db, db.leagues.find((l) => l.id === u.adminLeagueId) || { name: "Unassigned", regionalId: 0 }),
        })),
        applications: isOwner(user)
          ? db.applications
          : db.applications.filter((a) => {
              const league = db.leagues.find((l) => l.id === user.adminLeagueId);
              if (!league) return false;
              return a.regionalId === league.regionalId || (a.regionalIds || []).includes(league.regionalId);
            }),
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
      return json(res, 200, { ok: true, user: publicUser(u) });
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
      return json(res, 200, { ok: true, user: publicUser(u) });
    }
    if (method === "POST" && p === "/api/admin/revoke-admin") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can do this" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u || u.role !== "admin") return json(res, 400, { ok: false, error: "Not a league admin" });
      u.role = "player";
      u.adminLeagueId = null;
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u) });
    }
    if (method === "POST" && p === "/api/admin/place-player") {
      const u = db.users.find((x) => x.id === Number(body.userId));
      const league = db.leagues.find((l) => l.id === Number(body.leagueId));
      if (!u || !league) return json(res, 400, { ok: false, error: "Invalid player or league" });
      if (!managesLeague(user, league.id)) return json(res, 403, { ok: false, error: "You can only place players in your league" });
      u.leagueId = league.id;
      u.regionalId = league.regionalId;
      if (body.applicationId) {
        const appn = db.applications.find((a) => a.id === Number(body.applicationId));
        if (appn) appn.status = "placed";
      }
      const pending = db.applications.find((a) => a.userId === u.id && a.status === "pending");
      if (pending) pending.status = "placed";
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u) });
    }
    if (method === "POST" && p === "/api/admin/fixtures") {
      const leagueId = Number(body.leagueId);
      if (!managesLeague(user, leagueId)) return json(res, 403, { ok: false, error: "You can only create fixtures in your league" });
      const home = db.users.find((x) => x.id === Number(body.homeId));
      const away = db.users.find((x) => x.id === Number(body.awayId));
      if (!home || !away || home.id === away.id) return json(res, 400, { ok: false, error: "Choose two different players" });
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
      if (!fixture.screenshotFile) return json(res, 400, { ok: false, error: "Wait for a player to upload the screenshot" });
      const legsError = validateLegs(body.homeLegs, body.awayLegs);
      if (legsError) return json(res, 400, { ok: false, error: legsError });
      fixture.homeLegs = Number(body.homeLegs);
      fixture.awayLegs = Number(body.awayLegs);
      fixture.homeOneEighties = Number(body.homeOneEighties) || 0;
      fixture.awayOneEighties = Number(body.awayOneEighties) || 0;
      fixture.oneEighties = fixture.homeOneEighties + fixture.awayOneEighties;
      fixture.topCheckout = Number(body.topCheckout) || 0;
      fixture.status = "played";
      fixture.confirmedBy = user.id;
      fixture.confirmedAt = new Date().toISOString();
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
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
