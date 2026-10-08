// Place a player lists each unplaced player once, with their 3DA.
// Open seats for the same departed player are not repeated.
// The desk shows how many open spots each division has, not who left.
// Run: `node server/place-player-list.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openSpotLabel, openSpotsByDivision, placePlayerOptionLabel, uniqueOpenSeats, unplacedPlaceChoices } from "../public/placePlayers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const waiting = unplacedPlaceChoices([
  { id: 1, name: "Already In", email: "in@test.com", dartcounterName: "InDC", avg: 60, leagueIds: [9] },
  { id: 2, name: "Pat Player", email: "pat@test.com", dartcounterName: "PatDC", avg: 48.5, leagueIds: [] },
  { id: 2, name: "Pat Player", email: "pat@test.com", dartcounterName: "PatDC", avg: 48.5, leagueIds: [] },
  { id: 3, name: "Pat Player", email: "pat@test.com", dartcounterName: "PatDC-old", avg: 10, leagueIds: [], leagueId: null },
  { id: 4, name: "Sam Player", email: "sam@test.com", dartcounterName: "SamDC", avg: 55, leagueIds: [] },
  { id: 5, name: "Sam Player", email: "sam-two@test.com", dartcounterName: "SamTwoDC", avg: 41.25, leagueIds: [] },
  { id: 6, name: "Left Behind", email: "left@test.com", dartcounterName: "LeftDC", avg: 0, leagueId: 4 },
]);
check("placed players are left out of Place a player", waiting.every((p) => p.id !== 1 && p.id !== 6));
check("duplicate accounts collapse to one Pat", waiting.filter((p) => p.email === "pat@test.com").length === 1);
check("kept Pat is the account with the real 3DA", waiting.find((p) => p.email === "pat@test.com")?.id === 2);
check("two different Sams both stay", waiting.filter((p) => p.name === "Sam Player").length === 2);
const labels = waiting.map((p) => placePlayerOptionLabel(p, { duplicateName: waiting.filter((o) => o.name === p.name).length > 1 }));
check("Pat label shows 3DA", labels.some((label) => label === "Pat Player · 3DA 48.5"));
check("same-name players are told apart by DartCounter", labels.includes("Sam Player · 3DA 55 · SamDC") && labels.includes("Sam Player · 3DA 41.25 · SamTwoDC"));
check(
  "open seats do not repeat one departed player",
  uniqueOpenSeats([
    { id: 1, leagueId: 9, userId: 8, playerName: "Pat Player", matches: 2, playedMatches: 0 },
    { id: 2, leagueId: 9, userId: 8, playerName: "Pat Player", matches: 2, playedMatches: 0 },
    { id: 3, leagueId: 9, userId: 9, playerName: "Sam Player", matches: 1, playedMatches: 1 },
  ]).map((seat) => seat.userId).join(",") === "8,9"
);

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const placeStart = appJs.indexOf('<h2 class="text-lg font-bold">Place a player</h2>');
const placeForm = appJs.slice(placeStart, appJs.indexOf('data-form="FIXTURES"', placeStart));
check("place form lists the unplaced choices", placeForm.includes("placeChoices.map(placePlayerOption)"));
check("place form does not list every account", !placeForm.includes("everyone.map(playerOption)"));
check("place form explains the 3DA list", placeForm.includes("each once, with their 3DA"));
check("place form shows an open-spot count for each division", placeForm.includes("openSpotRows") && placeForm.includes("openSpotLabel"));
check("place form does not name the player being replaced", !placeForm.includes("open seat for") && !placeForm.includes("seat.playerName"));
const spotRows = openSpotsByDivision(
  [
    { id: 1, leagueId: 9, userId: 8, playerName: "Pat Player", leagueTitle: "TSH International Division 1" },
    { id: 2, leagueId: 9, userId: 8, playerName: "Pat Player", leagueTitle: "TSH International Division 1" },
    { id: 3, leagueId: 9, userId: 9, playerName: "Sam Player", leagueTitle: "TSH International Division 1" },
    { id: 4, leagueId: 10, userId: 10, playerName: "Left Behind", leagueTitle: "TSH International Division 2" },
  ],
  [
    { id: 9, title: "TSH International Division 1" },
    { id: 10, title: "TSH International Division 2" },
    { id: 11, title: "TSH International Division 3" },
  ]
);
check("duplicate departed players count as one open spot", spotRows.find((row) => row.leagueId === 9)?.openSpots === 2);
check("a division with nobody to replace shows zero", spotRows.find((row) => row.leagueId === 11)?.openSpots === 0 && openSpotLabel(0) === "0 open spots");
check("one open spot uses the singular", openSpotLabel(1) === "1 open spot" && spotRows.find((row) => row.leagueId === 10)?.openSpots === 1);
check("open-spot rows do not carry the replaced player's name", spotRows.every((row) => !("playerName" in row)));

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-place-list-"));
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

  const division = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: 3, name: "Place List" },
  });
  const leagueId = division.data.league?.id;
  check("division created", division.status === 200 && leagueId);

  async function register(name, avg) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    return api(port, "/api/auth/register", {
      method: "POST",
      body: {
        name,
        email: `${slug}-place-list@test.com`,
        password: "pass1234",
        regional: "international",
        dartcounterName: `${slug}-dc`,
        avg,
      },
    });
  }

  const pat = await register("Pat Waiting", 48.5);
  const sam = await register("Sam Placed", 61);
  const rex = await register("Rex Rival", 52);
  check("players registered", pat.status === 200 && sam.status === 200 && rex.status === 200);

  const placeSam = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: sam.data.user.id, leagueId },
  });
  const placeRex = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: rex.data.user.id, leagueId },
  });
  check("two players placed", placeSam.status === 200 && placeRex.status === 200);

  const fixture = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: sam.data.user.id, awayId: rex.data.user.id, week: 1, date: "2024-06-03", season: 1 },
  });
  check("fixture created", fixture.status === 200 && fixture.data.fixture?.id);

  const removed = await api(port, "/api/admin/unplace-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: sam.data.user.id, leagueId },
  });
  check("sam unplaced into an open seat", removed.status === 200 && removed.data.byes === 1);

  const dbPath = path.join(dir, "db.json");
  const stored = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const original = (stored.vacantSlots || []).find((slot) => Number(slot.userId) === Number(sam.data.user.id));
  check("one stored seat before the duplicate", original && (stored.vacantSlots || []).filter((slot) => Number(slot.userId) === Number(sam.data.user.id)).length === 1);
  stored.vacantSlots.push({
    ...original,
    id: Math.max(...stored.vacantSlots.map((slot) => Number(slot.id) || 0)) + 1,
    createdAt: "2099-01-01T00:00:00.000Z",
    seats: original.seats.map((seat) => ({ ...seat })),
  });
  fs.writeFileSync(dbPath, JSON.stringify(stored));

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  const choices = unplacedPlaceChoices(overview.data.users || []);
  const choiceIds = choices.map((p) => p.id);
  check("overview choices keep Pat", choiceIds.includes(pat.data.user.id));
  check("overview choices omit the player still in the division", !choiceIds.includes(rex.data.user.id));
  check(
    "Pat's 3DA is the value staff would see",
    placePlayerOptionLabel(choices.find((p) => p.id === pat.data.user.id)) === "Pat Waiting · 3DA 48.5"
  );
  const samSeats = (overview.data.openSeats || []).filter((seat) => Number(seat.userId) === Number(sam.data.user.id));
  check("duplicate open seat collapses to one row", samSeats.length === 1 && samSeats[0].matches === 1 && samSeats[0].playerName === "Sam Placed");
  const spotList = openSpotsByDivision(overview.data.openSeats, overview.data.allLeagues || []);
  const listed = spotList.find((row) => row.leagueId === leagueId);
  check(
    "that division shows one open spot and not Sam's name",
    listed?.openSpots === 1 && listed?.leagueTitle?.includes("Place List") && !("playerName" in (listed || {}))
  );

  const filler = await register("Ivy Next", 44);
  const seated = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: filler.data.user.id, leagueId },
  });
  const after = await api(port, "/api/admin/overview", { token: ownerTok });
  const spotsAfter = openSpotsByDivision(after.data.openSeats, after.data.allLeagues || []);
  check(
    "one placement fills the collapsed seat",
    seated.status === 200 &&
      seated.data.filledSeat?.replacedName === "Sam Placed" &&
      seated.data.filledSeat?.matches === 1 &&
      !(after.data.openSeats || []).some((seat) => Number(seat.userId) === Number(sam.data.user.id)) &&
      spotsAfter.find((row) => row.leagueId === leagueId)?.openSpots === 0
  );
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
console.log("\nAll place-player list checks passed.");
