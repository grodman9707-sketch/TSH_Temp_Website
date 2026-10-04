// Division week grids stay aligned. A division regenerated a week late is
// pulled back so its unplayed week releases with the others. Played matches
// stay on the dates they were actually played.
// Run: `node server/fixture-calendar.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { alignLaggingDivisionWeeks } from "./fixtureCalendar.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

function fixture(partial) {
  return {
    id: partial.id,
    leagueId: partial.leagueId,
    season: 1,
    week: partial.week,
    status: partial.status || "scheduled",
    bye: false,
    weekStart: partial.weekStart,
    date: partial.date || partial.weekStart,
    homeId: 1,
    awayId: 2,
  };
}

console.log("Unit: one-week lag is pulled back, played matches stay:");
const sample = [
  fixture({ id: 1, leagueId: 9, week: 3, weekStart: "2026-10-05" }),
  fixture({ id: 2, leagueId: 11, week: 3, weekStart: "2026-10-05" }),
  fixture({ id: 3, leagueId: 12, week: 3, weekStart: "2026-10-05" }),
  fixture({ id: 4, leagueId: 10, week: 1, weekStart: "2026-09-21", status: "played", date: "2026-09-24" }),
  fixture({ id: 5, leagueId: 10, week: 2, weekStart: "2026-09-28", status: "scheduled", date: "2026-09-29" }),
  fixture({ id: 6, leagueId: 10, week: 3, weekStart: "2026-10-12", date: "2026-10-14" }),
  fixture({ id: 7, leagueId: 10, week: 4, weekStart: "2026-10-19" }),
  fixture({ id: 8, leagueId: 9, week: 4, weekStart: "2026-10-12" }),
  fixture({ id: 9, leagueId: 11, week: 4, weekStart: "2026-10-12" }),
  fixture({ id: 10, leagueId: 13, week: 1, weekStart: "2026-09-26", status: "scheduled" }),
  fixture({ id: 11, leagueId: 13, week: 1, weekStart: "2026-09-21", status: "played" }),
  fixture({ id: 12, leagueId: 9, week: 1, weekStart: "2026-09-21", status: "played" }),
];
const moved = alignLaggingDivisionWeeks(sample);
check("two lagging unplayed fixtures move", moved === 2);
check("week 3 match day stays inside the corrected week", sample[5].weekStart === "2026-10-05" && sample[5].date === "2026-10-07");
check("the following week moves with it", sample[6].weekStart === "2026-10-12" && sample[6].date === "2026-10-12");
check("played week 1 date is unchanged", sample[3].weekStart === "2026-09-21" && sample[3].date === "2026-09-24" && sample[3].status === "played");
check("week 2 that already matches the grid is unchanged", sample[4].weekStart === "2026-09-28" && sample[4].date === "2026-09-29");
check("a mid-week start that is not 7 days late stays", sample[9].weekStart === "2026-09-26");
check("running the alignment again moves nothing", alignLaggingDivisionWeeks(sample) === 0);

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

console.log("\nStartup repair releases the lagging division's week 3:");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-week-grid-"));
const seed = JSON.parse(fs.readFileSync(path.join(root, "data/db.json"), "utf8"));
seed.fixtures = [
  fixture({ id: 1, leagueId: 9, week: 3, weekStart: "2026-10-05" }),
  fixture({ id: 2, leagueId: 11, week: 3, weekStart: "2026-10-05" }),
  fixture({ id: 3, leagueId: 12, week: 3, weekStart: "2026-10-05" }),
  fixture({ id: 4, leagueId: 10, week: 1, weekStart: "2026-09-21", status: "played", date: "2026-09-24" }),
  fixture({ id: 5, leagueId: 10, week: 3, weekStart: "2026-10-12" }),
  fixture({ id: 6, leagueId: 10, week: 14, weekStart: "2026-12-28" }),
  fixture({ id: 7, leagueId: 14, week: 14, weekStart: "2026-12-21" }),
  fixture({ id: 8, leagueId: 12, week: 14, weekStart: "2026-12-21" }),
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
  const division2 = await fetch(`http://127.0.0.1:${port}/api/leagues/10`).then((res) => res.json());
  const weeks = (division2.fixtures || []).map((f) => `${f.week}:${f.weekStart}`).sort();
  check("division 2 week 3 is public on the corrected Sunday", weeks.includes("3:2026-10-05"));
  check("the played week 1 result is still public on its original week", weeks.includes("1:2026-09-21"));
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
  const week14 = stored.fixtures.find((f) => f.id === 6);
  const played = stored.fixtures.find((f) => f.id === 4);
  check("the last unplayed week lines up with the other divisions", week14?.weekStart === "2026-12-21");
  check("stored played date is untouched", played?.date === "2026-09-24" && played?.status === "played");
  check("the repair is marked done so a later edit is not pulled back again", stored.structure?.weekGridAligned === true);
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
console.log("\nAll fixture-calendar checks passed.");
