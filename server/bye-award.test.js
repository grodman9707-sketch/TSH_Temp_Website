// A bye stays a bye until the next week is released, then it is a 5-0.
// Filling the open spot clears that default and the match is played for a result.
// Run: `node server/bye-award.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { awardByeWin, awardDueByeWins, byeAwardAt, byeAwardDue, clearByeAward, isOpenBye } from "./byeAward.js";
import { standingsForLeague } from "./standings.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

function bye(partial) {
  return {
    id: 1,
    leagueId: 9,
    season: 1,
    week: 4,
    weekStart: "2026-11-01",
    date: "2026-11-01",
    status: "bye",
    bye: true,
    homeId: 1,
    awayId: null,
    homeLegs: null,
    awayLegs: null,
    ...partial,
  };
}

console.log("Unit: a week 4 bye waits for week 5:");
const week5 = bye({ id: 2, week: 5, weekStart: "2026-11-08", status: "scheduled", bye: false, homeId: 2, awayId: 3 });
const week4 = bye();
const pair = [week4, week5];
const during = new Date("2026-11-04T18:00:00.000Z");
const justBefore = new Date("2026-11-07T23:59:59.999Z");
const atRelease = new Date("2026-11-08T00:00:00.000Z");
check("week 5 release is the award time", byeAwardAt(week4, pair)?.toISOString() === "2026-11-08T00:00:00.000Z");
check("still a bye during week 4", byeAwardDue(week4, pair, during) === false);
check("still a bye 1ms before week 5", byeAwardDue(week4, pair, justBefore) === false);
check("due at the moment week 5 is released", byeAwardDue(week4, pair, atRelease) === true);

const lateWeek5 = bye({ id: 2, week: 5, weekStart: "2026-11-15", status: "scheduled", bye: false, homeId: 2, awayId: 3 });
check("a later week 5 holds the win until that Sunday", byeAwardAt(week4, [week4, lateWeek5])?.toISOString() === "2026-11-15T00:00:00.000Z");
check("the following Sunday is not enough when week 5 is later", byeAwardDue(week4, [week4, lateWeek5], atRelease) === false);
check("the win lands when that later week 5 is released", byeAwardDue(week4, [week4, lateWeek5], new Date("2026-11-15T00:00:00.000Z")) === true);

const alone = bye();
check("with no week 5, the win lands one week later", byeAwardAt(alone, [alone])?.toISOString() === "2026-11-08T00:00:00.000Z");
check("a shared Sunday on a higher week number does not award early", byeAwardDue(week4, [week4, bye({ id: 8, week: 5, weekStart: "2026-11-01", status: "scheduled", bye: false, homeId: 2, awayId: 3 })], during) === false);

check("both sides empty is not a win", isOpenBye(bye({ homeId: null, awayId: null })) === false);
check("a real match is not a bye win", isOpenBye(bye({ bye: false, status: "scheduled", awayId: 2 })) === false);
check("a bye with no date is not due", byeAwardDue(bye({ weekStart: "", date: "" }), [], atRelease) === false);

const scored = bye();
check("awarding sets 5-0 for the player who is there", awardByeWin(scored, [scored], atRelease) === true && scored.status === "played" && scored.byeAwarded === true && scored.bye === false && scored.homeLegs === 5 && scored.awayLegs === 0);
check("awarding again does nothing", awardByeWin(scored, [scored], atRelease) === false);
const awayBye = bye({ homeId: null, awayId: 4 });
awardByeWin(awayBye, [awayBye], atRelease);
check("the away player gets the 5", awayBye.homeLegs === 0 && awayBye.awayLegs === 5 && awayBye.byeAwarded === true);

const tableDb = {
  leagues: [{ id: 9, regionalId: 3, name: "Division 1" }],
  users: [{ id: 1, name: "Ada", avg: 50, leagueIds: [9] }],
  fixtures: [scored],
};
const row = standingsForLeague(tableDb, 9).find((item) => item.playerId === 1);
check("the 5-0 is a win on the table", row?.played === 1 && row?.won === 1 && row?.lost === 0 && row?.legsFor === 5 && row?.legsAgainst === 0 && row?.points === 7 && row?.avg === 50);

check("clearing the default removes the score", clearByeAward(scored) === true && scored.byeAwarded === false && scored.status === "scheduled" && scored.homeLegs == null && scored.awayLegs == null);
const afterClear = standingsForLeague({ ...tableDb, fixtures: [scored] }, 9).find((item) => item.playerId === 1);
check("a cleared bye win is not on the table", afterClear?.played === 0 && afterClear?.points === 0);

const batch = { fixtures: [bye({ id: 3 }), bye({ id: 4, week: 5, weekStart: "2026-11-08", status: "scheduled", bye: false, homeId: 2, awayId: 3 })] };
check("only the due bye is awarded", awardDueByeWins(batch, atRelease) === 1 && batch.fixtures[0].byeAwarded === true && batch.fixtures[1].status === "scheduled");
check("a second pass awards nothing", awardDueByeWins(batch, atRelease) === 0);

const played = bye({ bye: false, status: "played", awayId: 2, homeLegs: 5, awayLegs: 3 });
check("a played result is left alone", awardDueByeWins({ fixtures: [played] }, atRelease) === 0 && played.awayLegs === 3);

function thisSundayYmd(from = new Date()) {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - from.getUTCDay())).toISOString().slice(0, 10);
}
function addUtcDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-bye-award-"));
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
  console.log("\nAPI: default bye wins follow the next week:");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("fixtures explain when the 5-0 is added", appJs.includes("A 5–0 win is added when the next week is released"));

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const division = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: 3, name: "Bye Wins" },
  });
  const leagueId = division.data.league?.id;
  check("division created", division.status === 200 && leagueId);

  async function addPlayer(name) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const created = await api(port, "/api/auth/register", {
      method: "POST",
      body: {
        name,
        email: `${slug}-bye-award@test.com`,
        password: "pass1234",
        regional: "international",
        dartcounterName: `${slug}-bye-dc`,
        avg: 55,
      },
    });
    check(`register ${name}`, created.status === 200 && created.data.user?.id);
    const placed = await api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId: created.data.user.id, leagueId },
    });
    check(`place ${name}`, placed.status === 200);
    return created.data.user.id;
  }

  const ada = await addPlayer("Ada Bye");
  const bea = await addPlayer("Bea Bye");
  const calReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Cal Bye",
      email: "cal-bye-award@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "cal-bye-dc",
      avg: 55,
    },
  });
  const cal = calReg.data.user?.id;
  check("register Cal Bye", calReg.status === 200 && cal);
  const sunday = thisSundayYmd();
  const twoWeeksAgo = addUtcDays(sunday, -14);

  const openBye = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: bea, awayId: "bye", week: 4, date: sunday, season: 1 },
  });
  check("current bye is still a bye", openBye.status === 200 && openBye.data.fixture?.status === "bye" && openBye.data.fixture?.bye === true);
  const openId = openBye.data.fixture.id;

  const due = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: "bye", awayId: bea, week: 1, date: twoWeeksAgo, season: 1 },
  });
  check("older bye is created", due.status === 200 && due.data.fixture?.status === "bye");
  const dueId = due.data.fixture.id;

  const listed = await api(port, `/api/leagues/${leagueId}`);
  const dueRow = (listed.data.fixtures || []).find((f) => f.id === dueId);
  const openRow = (listed.data.fixtures || []).find((f) => f.id === openId);
  const beaRow = (listed.data.standings || []).find((row) => row.playerId === bea);
  const adaRow = (listed.data.standings || []).find((row) => row.playerId === ada);
  check(
    "week 1 bye is a 5-0 now that the next week has started",
    dueRow?.byeAwarded === true && dueRow?.status === "played" && dueRow?.homeName === "Bye" && dueRow?.awayName === "Bea Bye" && dueRow?.homeLegs === 0 && dueRow?.awayLegs === 5
  );
  check("the current week bye is not awarded yet", openRow?.status === "bye" && openRow?.bye === true && openRow?.byeAwarded !== true);
  check("only the released bye win is on the table", beaRow?.played === 1 && beaRow?.won === 1 && beaRow?.points === 7 && beaRow?.legsFor === 5 && beaRow?.legsAgainst === 0 && adaRow?.played === 0 && adaRow?.points === 0);

  const match = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: ada, awayId: bea, week: 2, date: twoWeeksAgo, season: 1 },
  });
  const matchId = match.data.fixture?.id;
  check("open match created", match.status === 200 && matchId);
  const removed = await api(port, "/api/admin/unplace-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: ada, leagueId },
  });
  check("leaving opens a bye", removed.status === 200 && removed.data.byes === 1);
  const vacated = (await api(port, "/api/admin/overview", { token: ownerTok })).data.fixtures.find((f) => f.id === matchId);
  check(
    "that bye is awarded because the next week has already started",
    vacated?.byeAwarded === true && vacated?.status === "played" && vacated?.homeName === "Bye" && vacated?.awayLegs === 5 && vacated?.homeLegs === 0
  );
  const beaAwarded = (await api(port, `/api/leagues/${leagueId}`)).data.standings.find((row) => row.playerId === bea);
  check("the opponent has both bye wins", beaAwarded?.played === 2 && beaAwarded?.points === 14);

  const filled = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: cal, leagueId },
  });
  check("the open spot is filled", filled.status === 200 && filled.data.filledSeat?.replacedName === "Ada Bye" && filled.data.filledSeat?.matches === 1);
  const restored = (await api(port, "/api/admin/overview", { token: ownerTok })).data.fixtures.find((f) => f.id === matchId);
  const afterFill = await api(port, `/api/leagues/${leagueId}`);
  const beaAfter = (afterFill.data.standings || []).find((row) => row.playerId === bea);
  check(
    "filling the spot puts the match back to a result",
    restored?.byeAwarded !== true && restored?.status === "scheduled" && restored?.bye === false && restored?.homeId === cal && restored?.awayId === bea && restored?.homeLegs == null
  );
  check("the default win comes off the table", beaAfter?.played === 1 && beaAfter?.points === 7);

  const edited = await api(port, `/api/admin/fixtures/${dueId}`, {
    method: "POST",
    token: ownerTok,
    body: { week: 1, weekStart: twoWeeksAgo, date: twoWeeksAgo, homeId: cal, awayId: bea },
  });
  check(
    "putting a player on an awarded bye clears the 5-0",
    edited.status === 200 && edited.data.fixture?.status === "scheduled" && edited.data.fixture?.byeAwarded !== true && edited.data.fixture?.homeLegs == null && edited.data.fixture?.homeId === cal
  );
  const clearedTable = (await api(port, `/api/leagues/${leagueId}`)).data.standings.find((row) => row.playerId === bea);
  check("no default bye win remains", clearedTable?.played === 0 && clearedTable?.points === 0);
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
console.log("\nAll bye-award checks passed.");
