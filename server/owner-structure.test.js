// Owner-only add/remove for regions, leagues, and divisions.
// Run: `node server/owner-structure.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

async function waitHealth(port, child) {
  const deadline = Date.now() + 15000;
  let lastErr;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw lastErr || new Error("server did not become healthy");
}

async function stop(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((r) => {
    const t = setTimeout(r, 2000);
    child.on("exit", () => {
      clearTimeout(t);
      r();
    });
  });
}

async function api(port, pathname, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function startServer(dataDir, port) {
  const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (buf) => {
    stderr += buf.toString();
  });
  return { child, stderr: () => stderr };
}

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("Owner desk has structure manager", appJs.includes("Regions, leagues") && appJs.includes("ADDREGIONAL") && appJs.includes("ADDLEAGUE"));
check("structure forms are owner-only", appJs.includes("Only owners can add or remove a region, league, or division"));
check("head admins do not get structure controls", /isHeadAdmin && !d.isOwner/.test(appJs) && appJs.includes("data-form=\"ADDREGIONAL\""));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-owner-structure-"));
const port = 18000 + Math.floor(Math.random() * 2000);
let { child, stderr } = startServer(dir, port);

try {
  await waitHealth(port, child);

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  check("owner overview includes structure", overview.status === 200 && Array.isArray(overview.data.structure?.regionals));
  const intl = (overview.data.structure?.regionals || []).find((r) => r.slug === "international");
  const europe = (overview.data.structure?.regionals || []).find((r) => r.slug === "europe");
  const americas = (overview.data.structure?.regionals || []).find((r) => r.slug === "americas");
  check("International is protected", intl?.international === true && intl?.canDelete === false);
  check("coming-soon regionals can be removed", europe?.canDelete === true && americas?.canDelete === true);

  const player = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Structure Player",
      email: "structure-player@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "StructurePlayerDC",
      avg: 48,
    },
  });
  check("player signup", player.status === 200 && player.data.token);
  const playerTok = player.data.token;
  const playerId = player.data.user.id;

  const playerAdd = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: playerTok,
    body: { regionalId: intl.id, name: "Division 99" },
  });
  check("player cannot add a division", playerAdd.status === 403);

  await api(port, "/api/admin/assign-head-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId },
  });
  const headOverview = await api(port, "/api/admin/overview", { token: playerTok });
  check("head admin overview has no structure", headOverview.status === 200 && headOverview.data.structure == null);
  const headAdd = await api(port, "/api/admin/structure/regionals", {
    method: "POST",
    token: playerTok,
    body: { name: "Asia" },
  });
  check("head admin cannot add a region", headAdd.status === 403 && /only owners/i.test(headAdd.data.error || ""));

  const addDiv = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: intl.id, name: "Division 7", format: "Best of 9" },
  });
  check("owner can add International Division 7", addDiv.status === 200 && addDiv.data.league?.displayName === "Division 7");
  const div7Id = addDiv.data.league?.id;

  const dupDiv = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: intl.id, name: "Division 7" },
  });
  check("duplicate division name is rejected", dupDiv.status === 400);

  const place = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId: div7Id },
  });
  check("owner can place a player in the new division", place.status === 200);

  const addRegion = await api(port, "/api/admin/structure/regionals", {
    method: "POST",
    token: ownerTok,
    body: { name: "Asia", comingSoon: true },
  });
  check("owner can add a coming-soon region", addRegion.status === 200 && addRegion.data.regional?.slug === "asia" && addRegion.data.regional?.comingSoon === true);
  const asiaId = addRegion.data.regional?.id;

  const asiaDiv = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: asiaId, name: "Division 1" },
  });
  check("owner can add a division to a new region", asiaDiv.status === 200 && asiaDiv.data.league?.id);
  const asiaDivId = asiaDiv.data.league?.id;

  const placeAsiaSoon = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId: asiaDivId },
  });
  check("cannot place into a coming-soon region", placeAsiaSoon.status === 400 && /coming soon/i.test(placeAsiaSoon.data.error || ""));

  const playable = await api(port, "/api/admin/structure/regionals/update", {
    method: "POST",
    token: ownerTok,
    body: { id: asiaId, comingSoon: false },
  });
  check("owner can mark a region playable", playable.status === 200 && playable.data.regional?.comingSoon === false);

  const placeAsia = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId: asiaDivId },
  });
  check("owner can place a player in a new playable region", placeAsia.status === 200);

  const deleteIntl = await api(port, "/api/admin/structure/regionals/delete", {
    method: "POST",
    token: ownerTok,
    body: { id: intl.id },
  });
  check("International League cannot be removed", deleteIntl.status === 400 && /cannot be removed/i.test(deleteIntl.data.error || ""));

  const deleteAmericas = await api(port, "/api/admin/structure/regionals/delete", {
    method: "POST",
    token: ownerTok,
    body: { id: americas.id },
  });
  check("owner can remove Americas", deleteAmericas.status === 200);

  const d6 = (intl.leagues || []).find((l) => l.displayName === "Division 6" || l.name === "Division 6");
  const deleteD6 = await api(port, "/api/admin/structure/leagues/delete", {
    method: "POST",
    token: ownerTok,
    body: { id: d6?.id },
  });
  check("owner can remove International Division 6", deleteD6.status === 200);

  const nav = await api(port, "/api/regionals");
  const navIntl = (nav.data.regionals || []).find((r) => r.slug === "international");
  const navAsia = (nav.data.regionals || []).find((r) => r.slug === "asia");
  check("Americas is gone from public nav", !(nav.data.regionals || []).some((r) => r.slug === "americas"));
  check("Asia is in public nav", Boolean(navAsia) && (navAsia.leagues || []).some((l) => l.displayName === "Division 1"));
  check("Division 7 is in International nav", (navIntl?.leagues || []).some((l) => l.displayName === "Division 7"));
  check("Division 6 is gone from International nav", !(navIntl?.leagues || []).some((l) => l.displayName === "Division 6"));

  await stop(child);
  const port2 = port + 1;
  const restarted = startServer(dir, port2);
  child = restarted.child;
  stderr = restarted.stderr;
  await waitHealth(port2, child);

  const after = await api(port2, "/api/regionals");
  const afterIntl = (after.data.regionals || []).find((r) => r.slug === "international");
  check("restart keeps Asia", (after.data.regionals || []).some((r) => r.slug === "asia"));
  check("restart does not recreate Americas", !(after.data.regionals || []).some((r) => r.slug === "americas"));
  check("restart keeps Division 7", (afterIntl?.leagues || []).some((l) => l.displayName === "Division 7"));
  check("restart does not recreate Division 6", !(afterIntl?.leagues || []).some((l) => l.displayName === "Division 6"));
  check("restart still has Europe coming soon", (after.data.regionals || []).some((r) => r.slug === "europe" && r.comingSoon));

  const owner2 = await api(port2, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  const leftover = (afterIntl?.leagues || []).filter((l) => l.displayName !== "Division 1");
  for (const league of leftover) {
    await api(port2, "/api/admin/structure/leagues/delete", {
      method: "POST",
      token: owner2.data.token,
      body: { id: league.id },
    });
  }
  const lastIntl = (afterIntl?.leagues || []).find((l) => l.displayName === "Division 1");
  const deleteLast = await api(port2, "/api/admin/structure/leagues/delete", {
    method: "POST",
    token: owner2.data.token,
    body: { id: lastIntl?.id },
  });
  check("cannot remove the last International division", deleteLast.status === 400 && /at least one division/i.test(deleteLast.data.error || ""));
} catch (err) {
  failures++;
  console.error("  FAIL - suite error:", err.message);
  if (stderr()) console.error(stderr());
} finally {
  await stop(child);
}

const migrateDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-owner-structure-migrate-"));
fs.writeFileSync(
  path.join(migrateDir, "db.json"),
  JSON.stringify({
    league: { name: "The Social Hub Darts League", email: "thesocialhubinformation@gmail.com" },
    content: { faq: [], premium: [] },
    regionals: [{ id: 1, slug: "europe", name: "Europe", fullTitle: "TSH Europe", region: "Europe", active: true, sortOrder: 0 }],
    leagues: [{ id: 1, regionalId: 1, name: "League 1", format: "Best of 9", sortOrder: 0 }],
    users: [],
    applications: [],
    announcements: [],
    fixtures: [],
  })
);
const migratePort = port + 5;
const migrated = startServer(migrateDir, migratePort);
try {
  await waitHealth(migratePort, migrated.child);
  const named = await api(migratePort, "/api/regionals");
  const migratedIntl = (named.data.regionals || []).find((r) => r.slug === "international");
  const migratedEurope = (named.data.regionals || []).find((r) => r.slug === "europe");
  check("legacy migrate still seeds International Divisions 1–6", (migratedIntl?.leagues || []).length === 6);
  check("legacy migrate still marks Europe coming soon", migratedEurope?.comingSoon === true && (migratedEurope?.leagues || []).length === 0);
  const saved = JSON.parse(fs.readFileSync(path.join(migrateDir, "db.json"), "utf8"));
  check("legacy migrate then hands structure to owners", saved.structure?.ownerManaged === true);
} catch (err) {
  failures++;
  console.error("  FAIL - migrate:", err.message);
} finally {
  await stop(migrated.child);
}

try {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migrateDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("owner structure tests passed");
