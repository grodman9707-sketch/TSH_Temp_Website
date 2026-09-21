// Division admins only see/verify their assigned divisions.
// Head admins see and run every division, except owner override.
// Run: `node server/admin-roles.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("Owner override stays owner-only in the desk", appJs.includes("Owner override") && appJs.includes("d.isOwner || d.canOwnerOverride"));
check("Head admins get manage fixtures", appJs.includes("d.canOverride") && appJs.includes("Manage fixtures"));
check("Division admin copy hides other divisions", appJs.includes("Other divisions stay hidden"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-admin-roles-"));
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

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const divAdminReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Div Admin", email: "div-admin@test.com", password: "pass1234", regional: "international", dartcounterName: "DivAdminDC", avg: 50 },
  });
  const headReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Head Admin", email: "head-admin@test.com", password: "pass1234", regional: "international", dartcounterName: "HeadAdminDC", avg: 51 },
  });
  const d1Home = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "D1 Home", email: "d1-home@test.com", password: "pass1234", regional: "international", dartcounterName: "D1HomeDC", avg: 55 },
  });
  const d1Away = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "D1 Away", email: "d1-away@test.com", password: "pass1234", regional: "international", dartcounterName: "D1AwayDC", avg: 54 },
  });
  const d2Home = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "D2 Home", email: "d2-home@test.com", password: "pass1234", regional: "international", dartcounterName: "D2HomeDC", avg: 53 },
  });
  const d2Away = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "D2 Away", email: "d2-away@test.com", password: "pass1234", regional: "international", dartcounterName: "D2AwayDC", avg: 52 },
  });
  check(
    "register staff and players",
    [divAdminReg, headReg, d1Home, d1Away, d2Home, d2Away].every((r) => r.status === 200)
  );

  const divAdminId = divAdminReg.data.user.id;
  const headId = headReg.data.user.id;
  const divAdminTok = divAdminReg.data.token;
  const headTok = headReg.data.token;

  await api(port, "/api/admin/assign-admin", { method: "POST", token: ownerTok, body: { userId: divAdminId, leagueId: 9 } });
  await api(port, "/api/admin/assign-head-admin", { method: "POST", token: ownerTok, body: { userId: headId } });
  await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: d1Home.data.user.id, leagueId: 9 } });
  await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: d1Away.data.user.id, leagueId: 9 } });
  await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: d2Home.data.user.id, leagueId: 10 } });
  await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: d2Away.data.user.id, leagueId: 10 } });

  const d1Fix = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, week: 1, homeId: d1Home.data.user.id, awayId: d1Away.data.user.id, date: "2026-09-22", skipVisitorAccept: true },
  });
  const d2Fix = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 10, week: 1, homeId: d2Home.data.user.id, awayId: d2Away.data.user.id, date: "2026-09-22", skipVisitorAccept: true },
  });
  check("create one fixture per division", d1Fix.status === 200 && d2Fix.status === 200);
  const d1Id = d1Fix.data.fixture.id;
  const d2Id = d2Fix.data.fixture.id;

  const uploadD1 = await api(port, `/api/my-fixtures/${d1Id}/screenshots`, {
    method: "POST",
    token: d1Home.data.token,
    body: { image1: PNG, image2: PNG },
  });
  const uploadD2 = await api(port, `/api/my-fixtures/${d2Id}/screenshots`, {
    method: "POST",
    token: d2Home.data.token,
    body: { image1: PNG, image2: PNG },
  });
  check("screenshots in for both divisions", uploadD1.status === 200 && uploadD2.status === 200);

  const daOverview = await api(port, "/api/admin/overview", { token: divAdminTok });
  const daLeagues = (daOverview.data.leagues || []).map((l) => l.id);
  const daAll = (daOverview.data.allLeagues || []).map((l) => l.id);
  const daFixIds = (daOverview.data.fixtures || []).map((f) => f.id);
  check("division admin overview ok", daOverview.status === 200);
  check("division admin only sees assigned division", daLeagues.length === 1 && daLeagues[0] === 9);
  check("division admin allLeagues is scoped", daAll.length === 1 && daAll[0] === 9);
  check("division admin only sees assigned fixtures", daFixIds.includes(d1Id) && !daFixIds.includes(d2Id));
  check("division admin has no owner override flag", daOverview.data.canOwnerOverride === false && daOverview.data.canOverride === false);
  check("division admin does not receive structure", daOverview.data.structure == null);
  check("division admin stats are scoped to one division", daOverview.data.stats?.divisions === 1);

  const daOther = await api(port, `/api/admin/fixtures/${d2Id}/result`, {
    method: "POST",
    token: divAdminTok,
    body: { homeLegs: 5, awayLegs: 3 },
  });
  check("division admin cannot verify another division", daOther.status === 403 && /not your league/i.test(daOther.data.error || ""));

  const daNoShot = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: divAdminTok,
    body: { leagueId: 9, week: 2, homeId: d1Home.data.user.id, awayId: d1Away.data.user.id, date: "2026-09-29", skipVisitorAccept: true },
  });
  const extraId = daNoShot.data.fixture?.id;
  const daBlank = extraId
    ? await api(port, `/api/admin/fixtures/${extraId}/result`, {
        method: "POST",
        token: divAdminTok,
        body: { homeLegs: 5, awayLegs: 2 },
      })
    : { status: 0, data: {} };
  check("division admin cannot save stats without screenshots", daBlank.status === 400 && /screenshot/i.test(daBlank.data.error || ""));

  const daVerify = await api(port, `/api/admin/fixtures/${d1Id}/result`, {
    method: "POST",
    token: divAdminTok,
    body: { homeLegs: 5, awayLegs: 4, homeAvg: 60, awayAvg: 58 },
  });
  check("division admin can verify assigned division", daVerify.status === 200 && daVerify.data.fixture?.status === "played");

  const daReplay = await api(port, `/api/admin/fixtures/${d1Id}/result`, {
    method: "POST",
    token: divAdminTok,
    body: { homeLegs: 5, awayLegs: 1 },
  });
  check("division admin cannot overwrite a confirmed result", daReplay.status === 400 && /head admin or owner/i.test(daReplay.data.error || ""));

  const daPlaceOther = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: divAdminTok,
    body: { userId: headId, leagueId: 10 },
  });
  check("division admin cannot place into another division", daPlaceOther.status === 403);

  const daCreatePlayer = await api(port, "/api/admin/create-player", {
    method: "POST",
    token: divAdminTok,
    body: { name: "Ghost", email: "ghost@test.com", password: "pass1234" },
  });
  check("division admin cannot use owner override add player", daCreatePlayer.status === 403);

  const haOverview = await api(port, "/api/admin/overview", { token: headTok });
  const haFixIds = (haOverview.data.fixtures || []).map((f) => f.id);
  const haLeagueIds = (haOverview.data.leagues || []).map((l) => l.id);
  check("head admin overview ok", haOverview.status === 200);
  check("head admin sees every division", haLeagueIds.includes(9) && haLeagueIds.includes(10));
  check("head admin sees both division fixtures", haFixIds.includes(d1Id) && haFixIds.includes(d2Id));
  check("head admin can override confirmed results", haOverview.data.canOverride === true);
  check("head admin does not get owner override", haOverview.data.canOwnerOverride === false && haOverview.data.isOwner === false);
  check("head admin does not receive structure", haOverview.data.structure == null);

  const haVerify = await api(port, `/api/admin/fixtures/${d2Id}/result`, {
    method: "POST",
    token: headTok,
    body: { homeLegs: 5, awayLegs: 2, homeAvg: 61, awayAvg: 49 },
  });
  check("head admin can verify any division", haVerify.status === 200 && haVerify.data.fixture?.status === "played");

  const haOverwrite = await api(port, `/api/admin/fixtures/${d1Id}/result`, {
    method: "POST",
    token: headTok,
    body: { homeLegs: 5, awayLegs: 0, homeAvg: 70, awayAvg: 40 },
  });
  check("head admin can overwrite another admin’s result", haOverwrite.status === 200 && haOverwrite.data.fixture?.awayLegs === 0);

  const haBlank = extraId
    ? await api(port, `/api/admin/fixtures/${extraId}/result`, {
        method: "POST",
        token: headTok,
        body: { homeLegs: 5, awayLegs: 2 },
      })
    : { status: 0, data: {} };
  check("head admin cannot enter first stats without screenshots", haBlank.status === 400 && /screenshot/i.test(haBlank.data.error || ""));

  const haCreate = await api(port, "/api/admin/create-player", {
    method: "POST",
    token: headTok,
    body: { name: "Override Player", email: "override-player@test.com", password: "pass1234" },
  });
  check("head admin cannot add a player (owner override)", haCreate.status === 403 && /only owners/i.test(haCreate.data.error || ""));

  const haUnplace = await api(port, "/api/admin/unplace-player", {
    method: "POST",
    token: headTok,
    body: { userId: d1Home.data.user.id, leagueId: 9 },
  });
  check("head admin cannot unplace a player (owner override)", haUnplace.status === 403 && /only owners/i.test(haUnplace.data.error || ""));

  const haDeletePlayer = await api(port, "/api/admin/delete-player", {
    method: "POST",
    token: headTok,
    body: { userId: d2Away.data.user.id },
  });
  check("head admin cannot delete a player (owner override)", haDeletePlayer.status === 403 && /only owners/i.test(haDeletePlayer.data.error || ""));

  const haRegion = await api(port, "/api/admin/structure/regionals", {
    method: "POST",
    token: headTok,
    body: { name: "Pacific" },
  });
  check("head admin cannot add a region", haRegion.status === 403 && /only owners/i.test(haRegion.data.error || ""));

  const haClear = await api(port, `/api/admin/fixtures/${d2Id}/clear`, { method: "POST", token: headTok, body: {} });
  check("head admin can clear a confirmed result", haClear.status === 200 && haClear.data.fixture?.status !== "played");

  const haDeleteFix = extraId
    ? await api(port, `/api/admin/fixtures/${extraId}/delete`, { method: "POST", token: headTok, body: {} })
    : { status: 0, data: {} };
  check("head admin can delete a fixture", haDeleteFix.status === 200);

  const daDeleteFix = await api(port, `/api/admin/fixtures/${d1Id}/delete`, { method: "POST", token: divAdminTok, body: {} });
  check("division admin cannot delete fixtures", daDeleteFix.status === 403);

  const ownerCreate = await api(port, "/api/admin/create-player", {
    method: "POST",
    token: ownerTok,
    body: { name: "Owner Added", email: "owner-added@test.com", password: "pass1234", leagueId: 9 },
  });
  check("owner can still add a player", ownerCreate.status === 200 && ownerCreate.data.user?.name === "Owner Added");

  const ownerBlank = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, week: 3, homeId: d1Home.data.user.id, awayId: d1Away.data.user.id, date: "2026-10-06" },
  });
  const ownerBlankId = ownerBlank.data.fixture?.id;
  const ownerNoShot = ownerBlankId
    ? await api(port, `/api/admin/fixtures/${ownerBlankId}/result`, {
        method: "POST",
        token: ownerTok,
        body: { homeLegs: 5, awayLegs: 3 },
      })
    : { status: 0, data: {} };
  check("owner override can save stats without screenshots", ownerNoShot.status === 200 && ownerNoShot.data.fixture?.status === "played");
} catch (err) {
  failures++;
  console.error("  FAIL - suite error:", err.message);
  if (stderr) console.error(stderr);
} finally {
  if (child.exitCode == null) child.kill("SIGTERM");
}

try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("admin role tests passed");
