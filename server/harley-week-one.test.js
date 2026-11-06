// Jamie Hyde inherits Harley Jackson's week 1 loss, and nothing else moves.
// Run: `node server/harley-week-one.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { giveHarleyWeekOneToJamie } from "./harleyWeekOne.js";
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

function row(table, id) {
  return (table || []).find((item) => item.playerId === id);
}

const db = {
  leagues: [{ id: 13, regionalId: 3, name: "Division 4" }],
  users: [
    { id: 12, name: "Nathan Wilson", avg: 40, leagueIds: [13] },
    { id: 74, name: "jamie hyde", avg: 41, leagueIds: [13] },
    { id: 69, name: "Valerie Smith", avg: 43, leagueIds: [13] },
  ],
  fixtures: [
    {
      id: 58,
      leagueId: 13,
      week: 1,
      status: "played",
      homeId: 12,
      awayId: 51,
      homeLegs: 5,
      awayLegs: 0,
      homeAvg: 37.76,
      awayAvg: 34.63,
      homeCheckout: 40,
      awayCheckout: 0,
      home60: 7,
      away60: 3,
      home180: 0,
      away180: 1,
      awayOneEighties: 1,
      awayArchiveName: "Harley jackson",
      topCheckout: 40,
      oneEighties: 1,
    },
    {
      id: 394,
      leagueId: 13,
      week: 1,
      status: "played",
      homeId: 31,
      awayId: 69,
      homeLegs: 3,
      awayLegs: 5,
      homeArchiveName: "The Swansea Jack",
      awayAvg: 43.67,
    },
    {
      id: 80,
      leagueId: 13,
      week: 6,
      status: "played",
      homeId: null,
      awayId: 31,
      homeLegs: 0,
      awayLegs: 5,
      awayArchiveName: "The Swansea Jack",
      byeAwarded: true,
    },
  ],
};

check("the week 1 loss moves onto Jamie", giveHarleyWeekOneToJamie(db) === 1);
const harley = db.fixtures.find((fixture) => fixture.id === 58);
check(
  "the score stays 5-0 and Harley's average comes off",
  harley?.homeId === 12 &&
    harley?.awayId === 74 &&
    harley?.homeLegs === 5 &&
    harley?.awayLegs === 0 &&
    harley?.homeAvg === 37.76 &&
    harley?.homeCheckout === 40 &&
    harley?.home60 === 7 &&
    !harley?.awayAvg &&
    !harley?.away180 &&
    !harley?.awayOneEighties &&
    !harley?.away60 &&
    harley?.awayArchiveName === "" &&
    harley?.topCheckout === 40 &&
    harley?.oneEighties === 0
);
const swansea = db.fixtures.find((fixture) => fixture.id === 394);
const swanseaBye = db.fixtures.find((fixture) => fixture.id === 80);
check("Swansea's week 1 result is left alone", swansea?.homeId === 31 && swansea?.homeLegs === 3 && swansea?.awayLegs === 5 && swansea?.homeArchiveName === "The Swansea Jack");
check("Swansea's bye is left alone", swanseaBye?.awayId === 31 && swanseaBye?.awayLegs === 5);
check("a second pass changes nothing", giveHarleyWeekOneToJamie(db) === 0 && harley?.awayId === 74);

const table = standingsForLeague(db, 13);
check(
  "Jamie is credited with the loss and the legs against",
  row(table, 74)?.played === 1 && row(table, 74)?.won === 0 && row(table, 74)?.lost === 1 && row(table, 74)?.legsFor === 0 && row(table, 74)?.legsAgainst === 5 && row(table, 74)?.oneEighties === 0 && row(table, 74)?.avg === 41
);
check(
  "Nathan keeps the win",
  row(table, 12)?.played === 1 && row(table, 12)?.won === 1 && row(table, 12)?.legsFor === 5 && row(table, 12)?.legsAgainst === 0 && row(table, 12)?.avg === 37.8
);

const other = {
  users: [{ id: 74, name: "jamie hyde", leagueIds: [13] }],
  fixtures: [
    { id: 1, leagueId: 13, week: 1, status: "played", homeId: 51, awayId: 12, homeLegs: 5, awayLegs: 3, homeArchiveName: "Harley jackson" },
    { id: 2, leagueId: 13, week: 2, status: "played", homeId: 51, awayId: 12, homeLegs: 0, awayLegs: 5, homeArchiveName: "Harley jackson" },
  ],
};
check("only the week 1 0-5 is eligible", giveHarleyWeekOneToJamie(other) === 0 && other.fixtures[0].homeId === 51 && other.fixtures[1].homeId === 51);

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

console.log("\nStartup repair writes Jamie onto the stored week 1 result:");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-harley-week-"));
const seed = JSON.parse(fs.readFileSync(path.join(root, "data/db.json"), "utf8"));
seed.users.push(
  { id: 12, name: "Nathan Wilson", email: "nathan-harley@test.com", password: "pass1234", role: "player", roles: [], leagueId: 13, leagueIds: [13], regionalIds: [3], regionalId: 3, avg: 40 },
  { id: 74, name: "jamie hyde", email: "jamie-harley@test.com", password: "pass1234", role: "player", roles: [], leagueId: 13, leagueIds: [13], regionalIds: [3], regionalId: 3, avg: 41 }
);
const league = (seed.leagues || []).find((item) => item.id === 13) || { id: 13, regionalId: 3, name: "Division 4" };
if (!(seed.leagues || []).some((item) => item.id === 13)) seed.leagues.push(league);
seed.fixtures = [
  {
    id: 58,
    leagueId: 13,
    season: 1,
    week: 1,
    status: "played",
    date: "2026-09-22",
    weekStart: "2026-09-21",
    homeId: 12,
    awayId: 51,
    homeLegs: 5,
    awayLegs: 0,
    homeAvg: 37.76,
    awayAvg: 34.63,
    away180: 1,
    awayArchiveName: "Harley jackson",
  },
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
  const division = await fetch(`http://127.0.0.1:${port}/api/leagues/13`).then((res) => res.json());
  const fixture = (division.fixtures || []).find((item) => item.id === 58);
  const jamie = (division.standings || []).find((item) => item.playerId === 74);
  const nathan = (division.standings || []).find((item) => item.playerId === 12);
  check(
    "the division fixture names Jamie on Harley's side of the 5-0",
    fixture?.homeName === "Nathan Wilson" && fixture?.awayName === "jamie hyde" && fixture?.homeLegs === 5 && fixture?.awayLegs === 0 && !fixture?.awayAvg
  );
  check(
    "the table gives Jamie the loss and keeps Nathan's win",
    jamie?.played === 1 && jamie?.lost === 1 && jamie?.won === 0 && jamie?.legsFor === 0 && jamie?.legsAgainst === 5 && nathan?.played === 1 && nathan?.won === 1 && nathan?.legsFor === 5
  );
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
  const saved = (stored.fixtures || []).find((item) => item.id === 58);
  check("the repair is stored", saved?.awayId === 74 && saved?.homeId === 12 && saved?.homeLegs === 5 && saved?.awayLegs === 0 && saved?.awayArchiveName === "");
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
console.log("\nAll Harley week 1 checks passed.");
