// Week-by-week fixture release: Sunday 00:00 GMT. Run: `node server/fixture-release.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  fixturePublishMeta,
  fixtureReleaseAt,
  isFixtureReleased,
  nextFixtureReleaseAt,
  releasedFixtures,
  sundayStartGmt,
} from "./fixtureRelease.js";
import { runDueNotifications } from "./notifications.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

console.log("Unit: Sunday 00:00 GMT release:");
check("Wednesday maps to the preceding Sunday", sundayStartGmt("2026-09-23")?.toISOString() === "2026-09-20T00:00:00.000Z");
check("Sunday maps to itself at 00:00 GMT", sundayStartGmt("2026-09-20")?.toISOString() === "2026-09-20T00:00:00.000Z");
check("Saturday maps to the preceding Sunday", sundayStartGmt("2026-09-26")?.toISOString() === "2026-09-20T00:00:00.000Z");
check("invalid date is null", sundayStartGmt("nope") === null);

const week2 = { id: 2, week: 2, weekStart: "2026-09-27", date: "2026-09-27", status: "scheduled" };
const week1 = { id: 1, week: 1, weekStart: "2026-09-20", date: "2026-09-20", status: "scheduled" };
const before = new Date("2026-09-26T23:59:59.999Z");
const atRelease = new Date("2026-09-27T00:00:00.000Z");
const after = new Date("2026-09-27T00:00:00.001Z");

check("week 1 is already live on Saturday", isFixtureReleased(week1, before) === true);
check("week 2 is hidden 1ms before Sunday 00:00 GMT", isFixtureReleased(week2, before) === false);
check("week 2 appears at Sunday 00:00 GMT", isFixtureReleased(week2, atRelease) === true);
check("week 2 stays visible after Sunday 00:00 GMT", isFixtureReleased(week2, after) === true);

const agreedLater = { id: 3, week: 1, weekStart: "2026-09-20", date: "2026-10-04", status: "scheduled", scheduleStatus: "agreed" };
check("agreed kickoff later in the season does not hide the current week", isFixtureReleased(agreedLater, before) === true);
check("release instant uses weekStart, not the agreed date", fixtureReleaseAt(agreedLater)?.toISOString() === "2026-09-20T00:00:00.000Z");

const playedFuture = { id: 4, week: 8, weekStart: "2026-11-08", date: "2026-11-08", status: "played" };
check("played results stay visible before that week drops", isFixtureReleased(playedFuture, before) === true);

const list = [week1, week2];
check("releasedFixtures on Saturday is only week 1", releasedFixtures(list, before).map((f) => f.id).join(",") === "1");
check("releasedFixtures on Sunday includes week 2", releasedFixtures(list, atRelease).map((f) => f.id).join(",") === "1,2");
check("nextFixtureReleaseAt is week 2's Sunday", nextFixtureReleaseAt(list, before)?.toISOString() === "2026-09-27T00:00:00.000Z");
check("nextFixtureReleaseAt is null once week 2 is live", nextFixtureReleaseAt(list, atRelease) === null);
check("publish meta ISO string", fixturePublishMeta(list, before).nextFixtureReleaseAt === "2026-09-27T00:00:00.000Z");

console.log("Unit: notifications wait until the week is public:");
const notifyNow = new Date("2026-09-21T12:00:00Z"); // Monday; week of 20 Sep is live, 27 Sep is not
const notifyDb = {
  leagues: [{ id: 1, name: "Division 1" }],
  users: [
    { id: 1, name: "A", email: "a@x.com", notifyPrefs: { email: true } },
    { id: 2, name: "B", email: "b@x.com", notifyPrefs: { email: true } },
  ],
  fixtures: [
    {
      id: 10,
      leagueId: 1,
      week: 2,
      weekStart: "2026-09-27",
      date: "2026-09-27",
      homeId: 1,
      awayId: 2,
      status: "scheduled",
      notify: { newHomeAt: null, newAwayAt: null, weekHomeAt: null, weekAwayAt: null, remind30At: null },
    },
    {
      id: 11,
      leagueId: 1,
      week: 1,
      weekStart: "2026-09-20",
      date: "2026-09-20",
      homeId: 1,
      awayId: 2,
      status: "scheduled",
      notify: { newHomeAt: null, newAwayAt: null, weekHomeAt: null, weekAwayAt: null, remind30At: null },
    },
  ],
};
const beforeDrop = runDueNotifications(notifyDb, notifyNow);
check("unreleased week 2 does not email anyone", beforeDrop.outbox.filter((m) => m.fixtureId === 10).length === 0);
check("unreleased week 2 does not stamp notify markers", notifyDb.fixtures[0].notify.newHomeAt == null && notifyDb.fixtures[0].notify.newAwayAt == null);
check("released week 1 still sends the scheduled alert", beforeDrop.outbox.filter((m) => m.fixtureId === 11 && m.type === "new_match").length === 2);
const onDrop = runDueNotifications(notifyDb, new Date("2026-09-27T00:00:00Z"));
check("week 2 emails go out at Sunday 00:00 GMT", onDrop.outbox.filter((m) => m.fixtureId === 10 && m.type === "new_match").length === 2);

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

function utcYmd(d) {
  return d.toISOString().slice(0, 10);
}
function addUtcDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return utcYmd(new Date(Date.UTC(y, m - 1, d + days)));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-fixture-release-"));
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
  console.log("API: public lists hide the next week until Sunday:");

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const players = [];
  for (const name of ["Alpha", "Bravo", "Charlie"]) {
    const reg = await api(port, "/api/auth/register", {
      method: "POST",
      body: {
        name: `${name} Release`,
        email: `${name.toLowerCase()}-release@test.com`,
        password: "pass1234",
        regional: "international",
        dartcounterName: `${name}RelDC`,
        avg: 50,
      },
    });
    check(`register ${name}`, reg.status === 200);
    const placed = await api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId: reg.data.user.id, leagueId: 9 },
    });
    check(`place ${name}`, placed.status === 200);
    players.push({ id: reg.data.user.id, token: reg.data.token });
  }

  const now = new Date();
  const thisSunday = utcYmd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay())));
  const nextSunday = addUtcDays(thisSunday, 7);

  const generated = await api(port, "/api/admin/fixtures/generate", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, season: 1, startDate: thisSunday },
  });
  check("generate a season from this week's Sunday", generated.status === 200 && generated.data.created >= 3);
  check(
    "generated fixtures keep weekStart",
    (generated.data.fixtures || []).every((f) => f.weekStart && f.weekStart === f.date)
  );

  const weeks = [...new Set((generated.data.fixtures || []).map((f) => Number(f.week)))].sort((a, b) => a - b);
  check("season has more than one week", weeks.length >= 2);

  const liveIds = new Set((generated.data.fixtures || []).filter((f) => f.weekStart === thisSunday).map((f) => f.id));
  const nextIds = new Set((generated.data.fixtures || []).filter((f) => f.weekStart === nextSunday).map((f) => f.id));
  check("this week and next week both exist", liveIds.size >= 1 && nextIds.size >= 1);

  const league = await api(port, "/api/leagues/9");
  const leagueIds = new Set((league.data.fixtures || []).map((f) => f.id));
  check("public league list includes this week's fixtures", [...liveIds].every((id) => leagueIds.has(id)));
  check("public league list hides next week's fixtures", [...nextIds].every((id) => !leagueIds.has(id)));
  check("public league reports the next Sunday drop", (league.data.nextFixtureReleaseAt || "").startsWith(`${nextSunday}T00:00:00`));

  const liveFix = (generated.data.fixtures || []).find((f) => liveIds.has(f.id));
  const livePlayer = players.find((p) => p.id === liveFix.homeId);
  const mine = await api(port, "/api/my-fixtures", { token: livePlayer.token });
  const mineIds = new Set((mine.data.fixtures || []).map((f) => f.id));
  check("my-fixtures includes this week's matches", mineIds.has(liveFix.id));
  check("my-fixtures hides next week's matches", [...nextIds].every((id) => !mineIds.has(id)));
  check("my-fixtures reports the next Sunday drop", (mine.data.nextFixtureReleaseAt || "").startsWith(`${nextSunday}T00:00:00`));

  const profile = await api(port, `/api/player/${livePlayer.id}`);
  const profileIds = new Set((profile.data.fixtures || []).map((f) => f.id));
  check("player profile hides next week's matches", [...nextIds].every((id) => !profileIds.has(id)));

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  const adminIds = new Set((overview.data.fixtures || []).map((f) => f.id));
  check("admin overview still lists next week's fixtures", [...nextIds].every((id) => adminIds.has(id)));
  const adminNext = (overview.data.fixtures || []).find((f) => nextIds.has(f.id));
  check("admin row marks next week unreleased", adminNext && adminNext.released === false);

  const hiddenId = [...nextIds][0];
  const hidden = (generated.data.fixtures || []).find((f) => f.id === hiddenId);
  const homePlayer = players.find((p) => p.id === hidden.homeId) || players[0];
  const propose = await api(port, `/api/fixtures/${hiddenId}/propose`, {
    method: "POST",
    token: homePlayer.token,
    body: { date: nextSunday, time: "19:00", tz: "UTC" },
  });
  check("players cannot propose a time on an unreleased fixture", propose.status === 404);

  const shot = await api(port, `/api/my-fixtures/${hiddenId}/screenshots`, {
    method: "POST",
    token: homePlayer.token,
    body: { image1: "data:image/png;base64,aaaa", image2: "data:image/png;base64,bbbb" },
  });
  check("players cannot upload screenshots for an unreleased fixture", shot.status === 404);

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("fixtures tab explains the Sunday GMT drop", appJs.includes("Sunday at 12:00am GMT"));
} catch (err) {
  failures++;
  console.error("  FAIL - suite error:", err.message);
  if (stderr) console.error(stderr);
} finally {
  child.kill("SIGTERM");
  await new Promise((r) => {
    if (child.exitCode != null) return r();
    child.once("exit", r);
    setTimeout(r, 2000);
  });
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll fixture-release checks passed.");
