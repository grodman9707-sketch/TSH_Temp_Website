// Standings list the players still in a division, and a move carries their
// published record onto the new division. The opponent who stayed keeps theirs.
// Run: `node server/standings.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { standingsRows } from "./airtableSync.js";
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
  regionals: [
    { id: 3, fullTitle: "TSH International" },
    { id: 1, fullTitle: "TSH Europe" },
  ],
  leagues: [
    { id: 9, regionalId: 3, name: "Division 1" },
    { id: 10, regionalId: 3, name: "Division 2" },
    { id: 1, regionalId: 1, name: "Division 1" },
  ],
  users: [
    { id: 1, name: "Ada Move", nickname: "Ada", avg: 50, leagueIds: [9] },
    { id: 2, name: "Bea Stay", nickname: "", avg: 40, leagueIds: [9] },
    { id: 3, name: "Cid Home", nickname: "", avg: 45, leagueIds: [10] },
  ],
  fixtures: [
    {
      id: 1,
      leagueId: 9,
      status: "played",
      homeId: 1,
      awayId: 2,
      homeLegs: 5,
      awayLegs: 3,
      homeAvg: 60.2,
      awayAvg: 55.4,
      home180: 1,
      away180: 2,
    },
    { id: 2, leagueId: 9, status: "bye", homeId: 1, awayId: null, bye: true },
    {
      id: 3,
      leagueId: 1,
      status: "played",
      homeId: 1,
      awayId: 2,
      homeLegs: 5,
      awayLegs: 0,
      homeAvg: 70,
      awayAvg: 30,
      home180: 4,
      away180: 0,
    },
  ],
};

const before = standingsForLeague(db, 9);
check("both listed players share the result", row(before, 1)?.won === 1 && row(before, 1)?.points === 7 && row(before, 1)?.legsFor === 5 && row(before, 1)?.oneEighties === 1 && row(before, 1)?.avg === 60.2);
check("the loser is on the same table", row(before, 2)?.lost === 1 && row(before, 2)?.legsFor === 3 && row(before, 2)?.oneEighties === 2 && row(before, 2)?.avg === 55.4);
check("a bye is not a played result", row(before, 1)?.played === 1);

db.users[0].leagueIds = [10];
const left = standingsForLeague(db, 9);
const joined = standingsForLeague(db, 10);
check("a moved player leaves the old table", !row(left, 1));
check("the player who stayed keeps the loss", row(left, 2)?.played === 1 && row(left, 2)?.lost === 1 && row(left, 2)?.legsFor === 3 && row(left, 2)?.oneEighties === 2 && row(left, 2)?.avg === 55.4);
check("the moved player's win is on the new table", row(joined, 1)?.played === 1 && row(joined, 1)?.won === 1 && row(joined, 1)?.points === 7 && row(joined, 1)?.legsFor === 5 && row(joined, 1)?.oneEighties === 1 && row(joined, 1)?.avg === 60.2);
check("another division's result does not follow across regionals", row(joined, 1)?.played === 1 && row(joined, 1)?.oneEighties === 1);
check("the new division still lists its other player", row(joined, 3)?.played === 0 && row(joined, 3)?.points === 0 && row(joined, 3)?.avg === 45);

db.users[1].leagueIds = [];
const emptied = standingsForLeague(db, 9);
check("an unplaced player is not listed", emptied.length === 0);

const sheets = standingsRows(db);
const adaSheet = sheets.find((item) => item.key === "10:1");
check("the export follows the moved player", adaSheet?.player === "Ada" && adaSheet?.won === 1 && adaSheet?.points === 7 && adaSheet?.division.includes("Division 2"));
check("the export omits the division they left", !sheets.some((item) => item.key === "9:1" || item.key === "9:2"));

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-standings-follow-"));
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

  async function addDivision(name) {
    const created = await api(port, "/api/admin/structure/leagues", {
      method: "POST",
      token: ownerTok,
      body: { regionalId: 3, name },
    });
    check(`division ${name} created`, created.status === 200 && created.data.league?.id);
    return created.data.league.id;
  }

  async function addPlayer(name, avg) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const created = await api(port, "/api/auth/register", {
      method: "POST",
      body: {
        name,
        email: `${slug}-standings@test.com`,
        password: "pass1234",
        regional: "international",
        dartcounterName: `${slug}-dc`,
        avg,
      },
    });
    check(`register ${name}`, created.status === 200 && created.data.user?.id);
    return created.data.user.id;
  }

  const fromId = await addDivision("Follow From");
  const toId = await addDivision("Follow To");
  const moverId = await addPlayer("Mover Stats", 48);
  const stayId = await addPlayer("Stay Stats", 47);
  const homeId = await addPlayer("Home Stats", 46);
  for (const [userId, leagueId] of [
    [moverId, fromId],
    [stayId, fromId],
    [homeId, toId],
  ]) {
    const placed = await api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId, leagueId },
    });
    check(`placed ${userId}`, placed.status === 200);
  }

  const fixture = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: fromId, homeId: moverId, awayId: stayId, week: 1, date: "2024-06-03", season: 1 },
  });
  check("fixture created", fixture.status === 200 && fixture.data.fixture?.id);
  const scored = await api(port, `/api/admin/fixtures/${fixture.data.fixture.id}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 2, homeAvg: 61.2, awayAvg: 55.4, homeOneEighties: 1, awayOneEighties: 2 },
  });
  check("result published", scored.status === 200 && scored.data.fixture?.status === "played");

  const fromTable = await api(port, `/api/leagues/${fromId}`);
  const moverBefore = (fromTable.data.standings || []).find((item) => item.playerId === moverId);
  const stayBefore = (fromTable.data.standings || []).find((item) => item.playerId === stayId);
  check("the division table has the win before the move", moverBefore?.won === 1 && moverBefore?.points === 7 && moverBefore?.avg === 61.2 && moverBefore?.oneEighties === 1);
  check("the division table has the loss before the move", stayBefore?.lost === 1 && stayBefore?.legsFor === 2 && stayBefore?.oneEighties === 2);

  const moved = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: moverId, leagueId: toId },
  });
  check("player moved divisions", moved.status === 200 && (moved.data.user?.leagueIds || []).includes(toId) && !(moved.data.user?.leagueIds || []).includes(fromId));

  const oldTable = await api(port, `/api/leagues/${fromId}`);
  const newTable = await api(port, `/api/leagues/${toId}`);
  const oldRows = oldTable.data.standings || [];
  const newRows = newTable.data.standings || [];
  const stayAfter = oldRows.find((item) => item.playerId === stayId);
  const moverAfter = newRows.find((item) => item.playerId === moverId);
  const homeAfter = newRows.find((item) => item.playerId === homeId);
  check("the old table no longer lists the moved player", !oldRows.some((item) => item.playerId === moverId));
  check("the player who stayed still has the loss", stayAfter?.played === 1 && stayAfter?.lost === 1 && stayAfter?.legsFor === 2 && stayAfter?.oneEighties === 2 && stayAfter?.avg === 55.4);
  check("the new table lists the moved player's win", moverAfter?.played === 1 && moverAfter?.won === 1 && moverAfter?.points === 7 && moverAfter?.legsFor === 5 && moverAfter?.oneEighties === 1 && moverAfter?.avg === 61.2);
  check("the other player in the new division is unchanged", homeAfter?.played === 0 && homeAfter?.points === 0);

  const fillerId = await addPlayer("Filler Stats", 44);
  const filled = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: fillerId, leagueId: fromId },
  });
  const afterFill = await api(port, "/api/admin/overview", { token: ownerTok });
  const kept = (afterFill.data.fixtures || []).find((item) => item.id === fixture.data.fixture.id);
  const moverStill = ((await api(port, `/api/leagues/${toId}`)).data.standings || []).find((item) => item.playerId === moverId);
  check("a later placement does not take the moved player's result", filled.status === 200 && !filled.data.filledSeat && kept?.homeId === moverId && kept?.status === "played");
  check("the moved player still has that win after someone else joins the old division", moverStill?.won === 1 && moverStill?.points === 7 && moverStill?.avg === 61.2);
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
console.log("\nAll standings checks passed.");
