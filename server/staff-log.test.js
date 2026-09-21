// Owner-only admin activity log.
// Run: `node server/staff-log.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { appendStaffLog, STAFF_LOG_MAX, staffLogPayload, summarizeStaffLog } from "./staffLog.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const now = new Date("2026-09-21T12:00:00.000Z");
const daysAgo = (d) => new Date(now.getTime() - d * 86400000);
const owner = { id: 1, name: "Gordon", role: "owner", roles: ["owner"] };
const head = { id: 2, name: "Pat Head", role: "head_admin", roles: ["head_admin"] };
const divAdmin = { id: 3, name: "Div Admin", role: "player", roles: ["admin"], adminLeagueIds: [9] };
const player = { id: 4, name: "Just Player", role: "player", roles: [] };

const unitDb = {
  users: [owner, head, divAdmin, player],
  staffLog: [],
};
appendStaffLog(unitDb, owner, { action: "approve_result", summary: "Old approval" }, daysAgo(40));
appendStaffLog(unitDb, divAdmin, { action: "approve_result", summary: "Approved C vs D", fixtureId: 12 }, daysAgo(10));
appendStaffLog(unitDb, head, { action: "override_result", summary: "Changed result", fixtureId: 11 }, daysAgo(3));
appendStaffLog(unitDb, head, { action: "approve_result", summary: "Approved A vs B 5–3", fixtureId: 10 }, daysAgo(2));
appendStaffLog(unitDb, owner, { action: "place_player", summary: "Placed A in L1", targetUserId: 4 }, daysAgo(1));

check("appendStaffLog ignores missing action", appendStaffLog(unitDb, owner, {}) == null);
check("newest entry is first", unitDb.staffLog[0].action === "place_player" && unitDb.staffLog[0].actorId === 1);
check("entries include actorRole", unitDb.staffLog.some((e) => e.actorRole === "Head Admin"));

const summary = summarizeStaffLog(unitDb, now);
const headRow = summary.byActor.find((r) => r.actorId === 2);
const adminRow = summary.byActor.find((r) => r.actorId === 3);
const ownerRow = summary.byActor.find((r) => r.actorId === 1);
const playerRow = summary.byActor.find((r) => r.actorId === 4);
check("summary lists current staff only", Boolean(headRow && adminRow && ownerRow) && !playerRow);
check("7-day approvals count head only", summary.approvals7d === 1);
check("30-day approvals include 10-day-old admin approve", summary.approvals30d === 2);
check("head 7-day actions include approve and override", headRow.actions7d === 2 && headRow.approvals7d === 1 && headRow.overrides30d === 1);
check("division admin 7-day idle, 30-day approval counted", adminRow.actions7d === 0 && adminRow.approvals30d === 1);
check("40-day-old owner approval is outside 30 days", ownerRow.approvals30d === 0 && ownerRow.actions7d === 1);

const capDb = { users: [owner], staffLog: [] };
for (let i = 0; i < STAFF_LOG_MAX + 5; i++) {
  appendStaffLog(capDb, owner, { action: "place_player", summary: `n${i}` }, new Date(now.getTime() + i * 1000));
}
check("staff log caps at 500", capDb.staffLog.length === STAFF_LOG_MAX);
check("cap keeps the newest entries", capDb.staffLog[0].summary === `n${STAFF_LOG_MAX + 4}`);

const payload = staffLogPayload(unitDb, now);
check("payload has entries and summary", Array.isArray(payload.entries) && payload.summary.totalEntries === unitDb.staffLog.length);

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-staff-log-"));
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

  const anon = await api(port, "/api/admin/activity");
  check("unauthenticated activity is 401", anon.status === 401);

  const playerReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Log Player",
      email: "staff-log-player@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "LogPlayerDC",
      avg: 50,
    },
  });
  check("register player", playerReg.status === 200 && playerReg.data.token);
  const playerTok = playerReg.data.token;
  const playerId = playerReg.data.user.id;
  const playerDenied = await api(port, "/api/admin/activity", { token: playerTok });
  check("player cannot read activity", playerDenied.status === 403);

  const ownerLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", ownerLogin.status === 200 && ownerLogin.data.token);
  const ownerTok = ownerLogin.data.token;

  const empty = await api(port, "/api/admin/activity", { token: ownerTok });
  check("owner can read empty activity", empty.status === 200 && Array.isArray(empty.data.entries));
  check("migrated staffLog starts empty", empty.data.entries.length === 0);
  check("summary lists owners among staff", (empty.data.summary?.byActor || []).some((r) => r.role === "Owner"));

  const overviewBefore = await api(port, "/api/admin/overview", { token: ownerTok });
  check("overview does not include the staff log", !("staffLog" in overviewBefore.data) && !("entries" in overviewBefore.data) && !overviewBefore.data.summary?.byActor);

  const place = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId: 9 },
  });
  check("place player still returns the user", place.status === 200 && place.data.user?.id === playerId && place.data.fullyPlaced === true);

  const afterPlace = await api(port, "/api/admin/activity", { token: ownerTok });
  check("placing a player is logged", afterPlace.data.entries?.[0]?.action === "place_player");
  check("place log names the player", /Log Player/.test(afterPlace.data.entries?.[0]?.summary || ""));

  const homeReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Log Home",
      email: "staff-log-home@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "LogHomeDC",
      avg: 55,
    },
  });
  const awayReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Log Away",
      email: "staff-log-away@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "LogAwayDC",
      avg: 52,
    },
  });
  const homeId = homeReg.data.user.id;
  const awayId = awayReg.data.user.id;
  await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: homeId, leagueId: 9 } });
  await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: awayId, leagueId: 9 } });
  const created = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, week: 1, homeId, awayId, date: "2026-08-19", skipVisitorAccept: true },
  });
  check("create fixture logged", created.status === 200 && created.data.fixture?.id);
  const fixtureId = created.data.fixture.id;

  const approve = await api(port, `/api/admin/fixtures/${fixtureId}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 3, homeAvg: 60, awayAvg: 50, home180: 1, away180: 0, homeCheckout: 80, awayCheckout: 40 },
  });
  check("owner can approve without opponent verify", approve.status === 200 && approve.data.fixture?.status === "played");

  const override = await api(port, `/api/admin/fixtures/${fixtureId}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 4, homeAvg: 61, awayAvg: 51, home180: 1, away180: 0, homeCheckout: 80, awayCheckout: 40 },
  });
  check("owner override still saves", override.status === 200);

  const afterResults = await api(port, "/api/admin/activity", { token: ownerTok });
  const actions = (afterResults.data.entries || []).map((e) => e.action);
  check("approve_result is logged", actions.includes("approve_result"));
  check("override_result is logged", actions.includes("override_result"));
  check("create_fixture is logged", actions.includes("create_fixture"));
  const ownerRowLive = (afterResults.data.summary?.byActor || []).find((r) => Number(r.actorId) === Number(ownerLogin.data.user.id));
  check("owner summary counts the approval", ownerRowLive?.approvals7d >= 1);
  check("owner summary counts the override", ownerRowLive?.overrides30d >= 1);

  const assign = await api(port, "/api/admin/assign-head-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId },
  });
  check("assign head admin", assign.status === 200);
  const headLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "staff-log-player@test.com", password: "pass1234" },
  });
  check("head admin login", headLogin.status === 200 && headLogin.data.token);
  const headTok = headLogin.data.token;
  const headActivity = await api(port, "/api/admin/activity", { token: headTok });
  check("head admin cannot read activity", headActivity.status === 403);
  const headOverview = await api(port, "/api/admin/overview", { token: headTok });
  check("head admin can still open overview", headOverview.status === 200 && headOverview.data.isHeadAdmin === true);
  check("head overview has no staff log payload", !("staffLog" in headOverview.data) && !("entries" in headOverview.data));

  const news = await api(port, "/api/admin/announcements", {
    method: "POST",
    token: headTok,
    body: { title: "Week note", body: "Results due Sunday." },
  });
  check("head admin can post news", news.status === 200);
  const ownerSeesNews = await api(port, "/api/admin/activity", { token: ownerTok });
  check("owner sees head admin news post", ownerSeesNews.data.entries?.[0]?.action === "post_news" && ownerSeesNews.data.entries?.[0]?.actorId === playerId);

  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  check("Owner desk fetches activity only for owners", appJs.includes("d.isOwner") && appJs.includes("/api/admin/activity") && appJs.includes("staffActivityPanel"));
  check("Staff activity is not a public nav route", !appJs.includes('activity: page') && !/href:\s*"\/activity"/.test(appJs));
  check("Head Admin desk copy does not mention the log", !/isHeadAdmin[\s\S]{0,400}Staff activity/.test(appJs));
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
console.log("\nAll staff-log checks passed.");
