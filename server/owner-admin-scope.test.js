// Owners keep full league control after they are also assigned as a division admin.
// Run: `node server/owner-admin-scope.test.js`
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-owner-scope-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (buf) => {
  stderr += buf.toString();
});

try {
  await waitHealth(port, child);
  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("owner desk stays the owner desk", appJs.includes('d.isOwner ? "Owner desk"'));
  check("owner copy says they still control every division", appJs.includes("even when you are also a Division Admin"));
  check("fixture and place dropdowns use every league for owners", appJs.includes("d.canOverride ? d.allLeagues || d.leagues : d.leagues"));
  check("owner tools are not hidden by a division-admin role", appJs.includes("manageFixturesDesk") === false && appJs.includes("Manage fixtures") && appJs.includes("d.isOwner"));

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;
  const ownerId = owner.data.user.id;

  const before = await api(port, "/api/admin/overview", { token: ownerTok });
  const leagueIds = (before.data.allLeagues || before.data.leagues || []).map((l) => l.id);
  check("site has more than one division", leagueIds.length > 1);
  const homeLeague = leagueIds[0];
  const otherLeague = leagueIds.find((id) => id !== homeLeague);

  const assign = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: ownerId, leagueId: homeLeague },
  });
  check(
    "owner can also be a division admin without losing owner",
    assign.status === 200 && assign.data.user?.role === "owner" && (assign.data.user?.roles || []).includes("owner") && (assign.data.user?.roles || []).includes("admin")
  );

  const homeReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Home Scope", email: "home-scope@test.com", password: "pass1234", regional: "international", dartcounterName: "HomeScopeDC", avg: 50 },
  });
  const awayReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Away Scope", email: "away-scope@test.com", password: "pass1234", regional: "international", dartcounterName: "AwayScopeDC", avg: 48 },
  });
  check("register two players", homeReg.status === 200 && awayReg.status === 200);
  const placeHome = await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: homeReg.data.user.id, leagueId: otherLeague } });
  const placeAway = await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: awayReg.data.user.id, leagueId: otherLeague } });
  check("owner can still place players in another division", placeHome.status === 200 && placeAway.status === 200);

  const created = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: otherLeague, homeId: homeReg.data.user.id, awayId: awayReg.data.user.id, week: 1, date: "2026-08-02" },
  });
  check("owner can create a fixture outside their division-admin post", created.status === 200 && created.data.fixture?.leagueId === otherLeague);
  const fixtureId = created.data.fixture?.id;

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  const seenLeagues = new Set((overview.data.leagues || []).map((l) => l.id));
  const seenFixtures = new Set((overview.data.fixtures || []).map((f) => f.id));
  check("overview still lists every division", leagueIds.every((id) => seenLeagues.has(id)));
  check("overview still lists the other division's fixture", seenFixtures.has(fixtureId));
  check("overview still marks them as owner", overview.data.isOwner === true && overview.data.canOverride === true);
  check("structure controls are still included", Array.isArray(overview.data.structure?.regionals) && overview.data.structure.regionals.length > 0);
  const adminRow = (overview.data.leagueAdmins || []).find((a) => a.id === ownerId && a.adminLeagueId === homeLeague);
  check("division admin list still shows the owner", Boolean(adminRow) && (adminRow.roles || []).includes("owner"));

  const removed = await api(port, `/api/admin/fixtures/${fixtureId}/delete`, { method: "POST", token: ownerTok, body: {} });
  check("owner can still delete that fixture", removed.status === 200);

  const divAdmin = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Div Only", email: "div-only-scope@test.com", password: "pass1234", regional: "international", dartcounterName: "DivOnlyDC", avg: 40 },
  });
  const assignDiv = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: divAdmin.data.user.id, leagueId: homeLeague },
  });
  check("plain division admin assigned", assignDiv.status === 200);
  const narrow = await api(port, "/api/admin/overview", { token: divAdmin.data.token });
  const narrowLeagues = (narrow.data.leagues || []).map((l) => l.id);
  check("a division admin stays limited to their division", narrow.data.isOwner === false && narrowLeagues.length === 1 && narrowLeagues[0] === homeLeague);
  check("a division admin does not receive owner structure", narrow.data.structure == null);
} catch (err) {
  failures++;
  console.error("  FAIL - suite error:", err.message);
  if (stderr) console.error(stderr);
} finally {
  if (child.exitCode == null) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(r, 2000);
      child.on("exit", () => {
        clearTimeout(t);
        r();
      });
    });
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nOwner admin-scope checks passed.");
