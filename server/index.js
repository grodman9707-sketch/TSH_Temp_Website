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
const publicDir = path.join(root, "public");

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

ensureStore();
const sessions = loadSessions();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
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
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
function tokenFrom(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return "";
}
function currentUser(req, db) {
  const id = sessions.get(tokenFrom(req));
  return db.users.find((u) => u.id === id) || null;
}
function standingsForLeague(db, leagueId) {
  const players = db.users.filter((u) => u.leagueId === leagueId && u.role !== "admin");
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
    home.oneEighties += f.oneEighties || 0;
    if (f.homeLegs > f.awayLegs) {
      home.won += 1;
      home.points += 2;
      away.lost += 1;
    } else if (f.awayLegs > f.homeLegs) {
      away.won += 1;
      away.points += 2;
      home.lost += 1;
    } else {
      home.points += 1;
      away.points += 1;
    }
  }
  return rows.map((r) => ({ ...r, diff: r.legsFor - r.legsAgainst })).sort((a, b) => b.points - a.points || b.diff - a.diff || b.legsFor - a.legsFor);
}
function stats(db) {
  const players = db.users.filter((u) => u.role === "player");
  const played = db.fixtures.filter((f) => f.status === "played");
  return {
    activePlayers: players.length,
    divisions: db.leagues.length,
    total180s: played.reduce((s, f) => s + (f.oneEighties || 0), 0),
    topCheckout: played.reduce((m, f) => Math.max(m, f.topCheckout || 0), 0),
  };
}
function withNames(db, f) {
  return {
    ...f,
    homeName: db.users.find((u) => u.id === f.homeId)?.name,
    awayName: db.users.find((u) => u.id === f.awayId)?.name,
    leagueName: db.leagues.find((l) => l.id === f.leagueId)?.name,
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
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

async function handleApi(req, res, url) {
  const db = readDb();
  const method = req.method;
  const p = url.pathname;
  const user = currentUser(req, db);
  const body = method === "GET" ? {} : await readBody(req);

  if (method === "GET" && p === "/api/content") return json(res, 200, { ok: true, content: db.content, league: db.league });
  if (method === "GET" && p === "/api/stats") return json(res, 200, stats(db));
  if (method === "GET" && p === "/api/regionals") return json(res, 200, { ok: true, regionals: db.regionals });
  if (method === "GET" && p === "/api/announcements") return json(res, 200, { ok: true, announcements: db.announcements });

  const regionalMatch = p.match(/^\/api\/regionals\/([^/]+)$/);
  if (method === "GET" && regionalMatch) {
    const regional = db.regionals.find((r) => r.slug === regionalMatch[1]);
    if (!regional) return json(res, 404, { ok: false, error: "Not found" });
    const leagues = db.leagues.filter((l) => l.regionalId === regional.id);
    const players = db.users.filter((u) => u.regionalId === regional.id && u.role === "player");
    return json(res, 200, { ok: true, regional, leagues, counts: { players: players.length, teams: 0, leagues: leagues.length } });
  }

  const leagueMatch = p.match(/^\/api\/leagues\/(\d+)$/);
  if (method === "GET" && leagueMatch) {
    const league = db.leagues.find((l) => l.id === Number(leagueMatch[1]));
    if (!league) return json(res, 404, { ok: false, error: "Not found" });
    const regional = db.regionals.find((r) => r.id === league.regionalId);
    return json(res, 200, {
      ok: true,
      league,
      regional,
      standings: standingsForLeague(db, league.id),
      fixtures: db.fixtures.filter((f) => f.leagueId === league.id).map((f) => withNames(db, f)),
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
      fixtures: db.fixtures.filter((f) => f.homeId === found.id || f.awayId === found.id).map((f) => withNames(db, f)),
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
    return json(res, 200, { ok: true, token, user: publicUser(created) });
  }

  if (method === "POST" && p === "/api/auth/login") {
    const found = db.users.find((u) => u.email.toLowerCase() === String(body.email || "").toLowerCase() && u.password === body.password);
    if (!found) return json(res, 401, { ok: false, error: "Invalid email or password" });
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, found.id);
    saveSessions();
    return json(res, 200, { ok: true, token, user: publicUser(found) });
  }

  if (!user && p.startsWith("/api/") && !p.startsWith("/api/auth") && !["/api/content", "/api/stats", "/api/regionals", "/api/announcements"].some((x) => p === x || p.startsWith("/api/regionals/") || p.startsWith("/api/leagues/") || p.startsWith("/api/player/"))) {
    if (["/api/apply", "/api/my-fixtures", "/api/auth/me", "/api/auth/logout", "/api/admin"].some((x) => p === x || p.startsWith(x))) {
      return json(res, 401, { ok: false, error: "Login required" });
    }
  }

  if (method === "GET" && p === "/api/auth/me") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    return json(res, 200, { ok: true, user: publicUser(user) });
  }
  if (method === "POST" && p === "/api/auth/logout") {
    sessions.delete(tokenFrom(req));
    saveSessions();
    return json(res, 200, { ok: true });
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
  const resultMatch = p.match(/^\/api\/my-fixtures\/(\d+)\/result$/);
  if (method === "POST" && resultMatch) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const fixture = db.fixtures.find((f) => f.id === Number(resultMatch[1]));
    if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
    if (fixture.homeId !== user.id && fixture.awayId !== user.id) return json(res, 403, { ok: false, error: "Not your match" });
    fixture.homeLegs = Number(body.homeLegs);
    fixture.awayLegs = Number(body.awayLegs);
    fixture.oneEighties = Number(body.oneEighties) || 0;
    fixture.topCheckout = Number(body.topCheckout) || 0;
    fixture.status = "played";
    writeDb(db);
    return json(res, 200, { ok: true, fixture });
  }
  if (p.startsWith("/api/admin")) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    if (user.role !== "admin") return json(res, 403, { ok: false, error: "Forbidden" });
    if (method === "GET" && p === "/api/admin/me") return json(res, 200, { ok: true, user: publicUser(user) });
    if (method === "GET" && p === "/api/admin/overview") {
      return json(res, 200, { ok: true, stats: stats(db), users: db.users.map(publicUser), applications: db.applications, leagues: db.leagues, fixtures: db.fixtures });
    }
    if (method === "POST" && p === "/api/admin/place-player") {
      const u = db.users.find((x) => x.id === Number(body.userId));
      const league = db.leagues.find((l) => l.id === Number(body.leagueId));
      if (!u || !league) return json(res, 400, { ok: false, error: "Invalid player or league" });
      u.leagueId = league.id;
      u.regionalId = league.regionalId;
      if (body.applicationId) {
        const appn = db.applications.find((a) => a.id === Number(body.applicationId));
        if (appn) appn.status = "placed";
      }
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u) });
    }
    if (method === "POST" && p === "/api/admin/fixtures") {
      const fixture = {
        id: Math.max(0, ...db.fixtures.map((f) => f.id)) + 1,
        leagueId: Number(body.leagueId),
        week: Number(body.week) || 1,
        homeId: Number(body.homeId),
        awayId: Number(body.awayId),
        homeLegs: null,
        awayLegs: null,
        status: "scheduled",
        date: body.date || new Date().toISOString().slice(0, 10),
        oneEighties: 0,
        topCheckout: 0,
      };
      db.fixtures.push(fixture);
      writeDb(db);
      return json(res, 200, { ok: true, fixture });
    }
    if (method === "POST" && p === "/api/admin/announcements") {
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
    json(res, 500, { ok: false, error: "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`TSH Darts League running on ${host}:${port}`);
  console.log(`Data directory: ${dataDir}`);
});
