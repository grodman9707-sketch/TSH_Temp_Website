// A roster name missing from one existing week gets that week as a bye.
// Run: `node server/roster-fixtures.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { fillMissingRosterByes } from "./rosterFixtures.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

console.log("Unit: only the single missing roster name gets a bye:");
const db = {
  users: [
    { id: 63, name: "Roy Butcher", leagueIds: [9] },
    { id: 17, name: "Tony duggan", leagueIds: [9] },
    { id: 30, name: "Guy ashton", leagueIds: [9] },
  ],
  fixtures: [
    { id: 1, leagueId: 9, season: 1, week: 1, weekStart: "2026-09-21", date: "2026-09-27", status: "played", homeId: 17, awayId: 30, homeLegs: 5, awayLegs: 2 },
    { id: 2, leagueId: 9, season: 1, week: 2, weekStart: "2026-09-28", status: "scheduled", homeId: 63, awayId: 17 },
    { id: 3, leagueId: 9, season: 1, week: 2, weekStart: "2026-09-28", status: "bye", bye: true, homeId: null, awayId: 30 },
  ],
};
const created = fillMissingRosterByes(db);
const royBye = db.fixtures.find((f) => f.week === 1 && f.homeId === 63 && f.bye);
check("one bye is added", created === 1 && royBye?.status === "bye" && royBye?.weekStart === "2026-09-21" && royBye?.awayId == null);
check("the played score is unchanged", db.fixtures[0].homeLegs === 5 && db.fixtures[0].awayLegs === 2 && db.fixtures[0].homeId === 17);
check("a second pass does not add another bye", fillMissingRosterByes(db) === 0 && db.fixtures.filter((f) => f.bye).length === 2);

const crowded = {
  users: [
    { id: 1, name: "A", leagueIds: [1] },
    { id: 2, name: "B", leagueIds: [1] },
    { id: 3, name: "C", leagueIds: [1] },
    { id: 4, name: "D", leagueIds: [1] },
  ],
  fixtures: [{ id: 1, leagueId: 1, season: 1, week: 1, weekStart: "2026-09-21", status: "scheduled", homeId: 1, awayId: 2 }],
};
check("two missing players do not get invented fixtures", fillMissingRosterByes(crowded) === 0 && crowded.fixtures.length === 1);

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

console.log("\nStartup repair gives the missing roster name a week-1 bye:");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-roster-bye-"));
const seed = JSON.parse(fs.readFileSync(path.join(root, "data/db.json"), "utf8"));
seed.users.push(
  { id: 63, name: "Roy Butcher", email: "roy-bye@test.com", password: "pass1234", role: "player", roles: [], leagueId: 9, leagueIds: [9], regionalIds: [3], regionalId: 3 },
  { id: 17, name: "Tony duggan", email: "tony-bye@test.com", password: "pass1234", role: "player", roles: [], leagueId: 9, leagueIds: [9], regionalIds: [3], regionalId: 3 },
  { id: 30, name: "Guy ashton", email: "guy-bye@test.com", password: "pass1234", role: "player", roles: [], leagueId: 9, leagueIds: [9], regionalIds: [3], regionalId: 3 }
);
seed.fixtures = [
  { id: 1, leagueId: 9, season: 1, week: 1, weekStart: "2026-09-21", date: "2026-09-27", status: "played", homeId: 17, awayId: 30, homeLegs: 5, awayLegs: 1 },
  { id: 2, leagueId: 9, season: 1, week: 2, weekStart: "2026-09-28", date: "2026-09-28", status: "scheduled", homeId: 63, awayId: 17 },
  { id: 3, leagueId: 9, season: 1, week: 2, weekStart: "2026-09-28", date: "2026-09-28", status: "bye", bye: true, homeId: 30, awayId: null },
];
fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify(seed));
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
  const division = await fetch(`http://127.0.0.1:${port}/api/leagues/9`).then((res) => res.json());
  const bye = (division.fixtures || []).find((f) => f.week === 1 && f.bye && f.homeName === "Roy Butcher");
  const played = (division.fixtures || []).find((f) => f.id === 1);
  check("division page shows Roy's week 1 bye", bye?.awayName === "Bye" && bye?.weekStart === "2026-09-21");
  check("the played week 1 score is unchanged", played?.homeLegs === 5 && played?.awayLegs === 1 && played?.homeName === "Tony duggan");
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
  check("the repair is marked done", stored.structure?.rosterWeekByesFilled === true && stored.fixtures.filter((f) => f.week === 1 && f.bye).length === 1);
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
console.log("\nAll roster-fixture checks passed.");
