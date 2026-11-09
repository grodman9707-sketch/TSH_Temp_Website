// Tournaments: signup, doubles pairing, and single-elimination brackets.
// Run: `node server/tournaments.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { nextWheelRotation, wheelPlan, wheelStopRotation, wheelSvg } from "../public/tournamentWheel.js";
import {
  avgBand,
  balanceTournamentTeams,
  buildSingleElim,
  createTournament,
  generateTournamentBracket,
  pairEven,
  pairRandomMixed,
  parseStartsAt,
  publicTournament,
  recordTournamentResult,
  seedPositions,
  signupTournament,
  updateTournament,
  withdrawTournament,
} from "./tournaments.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

function identityRng() {
  return 0.999999;
}

check("50.00 is 50+", avgBand(50) === "high" && avgBand(50.01) === "high");
check("49.99 is 50-", avgBand(49.99) === "low" && avgBand(0) === "low");
check("seed order keeps 1 opposite 2", JSON.stringify(seedPositions(8)) === JSON.stringify([1, 8, 4, 5, 2, 7, 3, 6]));
check("size 4 seed order", JSON.stringify(seedPositions(4)) === JSON.stringify([1, 4, 2, 3]));

const paired = pairRandomMixed(
  [
    { userId: 1, avg: 80 },
    { userId: 2, avg: 50 },
    { userId: 5, avg: 90 },
    { userId: 3, avg: 40 },
    { userId: 4, avg: 30 },
  ],
  identityRng
);
check(
  "random pairs are one 50+ and one 50-",
  paired.pairs.length === 2 &&
    paired.pairs.every(([a, b]) => avgBand(a.avg) !== avgBand(b.avg)) &&
    paired.unpaired.length === 1 &&
    paired.unpaired[0].userId === 5
);
check("a custom cutoff moves the 50 line", avgBand(60, 70) === "low" && avgBand(70, 70) === "high");
const evened = pairEven([
  { userId: 1, avg: 90 },
  { userId: 2, avg: 70 },
  { userId: 3, avg: 50 },
  { userId: 4, avg: 40 },
  { userId: 5, avg: 20 },
]);
const evenSums = evened.pairs.map(([a, b]) => a.avg + b.avg).sort((a, b) => a - b);
check(
  "even teams pair the highest average with the lowest and sit the middle player",
  evened.unpaired.length === 1 &&
    evened.unpaired[0].userId === 3 &&
    evenSums[0] === 110 &&
    evenSums[1] === 110
);

const bracket = buildSingleElim([
  { id: "t1", playerIds: [1], avg: 90 },
  { id: "t2", playerIds: [2], avg: 70 },
  { id: "t3", playerIds: [3], avg: 50 },
]);
const semis = bracket.rounds[0].matches;
check("top seed gets the bye", semis[0].teamAId === "t1" && semis[0].status === "bye" && semis[0].winnerTeamId === "t1");
check("other two meet in the first round", semis[1].teamAId === "t2" && semis[1].teamBId === "t3" && semis[1].status === "pending");
check("bye winner is waiting in the final", bracket.rounds[1].matches[0].teamAId === "t1" && bracket.rounds[1].matches[0].teamBId == null);
check(
  "New York wall time becomes UTC",
  parseStartsAt("2026-12-01T19:00", "America/New_York") === "2026-12-02T00:00:00.000Z"
);
check("a zoned instant is kept", parseStartsAt("2026-12-01T19:00:00.000Z", "America/New_York") === "2026-12-01T19:00:00.000Z");

const limitDb = {
  users: [
    { id: 1, name: "A", avg: 60 },
    { id: 2, name: "B", avg: 40 },
    { id: 3, name: "C", avg: 55 },
  ],
  tournaments: [],
};
const limitEvent = createTournament(limitDb, { id: 9 }, { title: "Limit", format: "singles", startsAt: "2026-12-01T19:00", tz: "UTC" });
for (const user of limitDb.users) signupTournament(limitDb, limitEvent.tournament.id, user);
const tooTight = updateTournament(limitDb, limitEvent.tournament.id, {
  title: "Limit",
  startsAt: "2026-12-01T19:00",
  tz: "UTC",
  capacity: 2,
});
check("player limit cannot drop below the field", tooTight.status === 400 && /already signed up/i.test(tooTight.error));

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("nav has a Tournaments tab", appJs.includes('["/tournaments", "Tournaments"]'));
check("tournament routes render", appJs.includes('if (q === "/tournaments")') && appJs.includes("pageTournament"));
check("staff can post from the tab", appJs.includes('data-form="POSTTOURNAMENT"') && appJs.includes("GENERATE BRACKET"));
check("players can sign up and choose a partner", appJs.includes('data-form="TOURNAMENTSIGNUP"') && appJs.includes('data-form="TOURNAMENTPARTNER"'));
check("bracket layout scrolls on a phone", css.includes(".bracket") && css.includes("overflow-x: auto"));
check("cache bust covers the new tab", html.includes("app.js?v=86") && html.includes("styles.css?v=86"));
check("staff can build even teams and fill blank seats", appJs.includes("MAKE EVEN TEAMS") && appJs.includes("ADD BLANK TEAM") && appJs.includes("Blank seat"));
check("staff can split a tournament into pools", appJs.includes('name="poolMode"') && appJs.includes("Split by division"));
check(
  "the signup wheel spins and the bracket takes its place",
  appJs.includes("data-tournament-wheel") &&
    appJs.includes("mountTournamentWheel") &&
    appJs.includes("function tournamentStage") &&
    appJs.includes("return tournamentWheel(t)") &&
    css.includes(".wheel-rotor")
);
check("admins record a win or a loss", appJs.includes('name="winnerTeamId"') && appJs.includes("${team.name} wins") && !appJs.includes('placeholder="Legs"'));

function mod360(n) {
  return ((n % 360) + 360) % 360;
}
check(
  "the wheel centers a slice under the pointer",
  Math.abs(mod360(wheelStopRotation(0, 4)) - mod360(-45)) < 0.001 && Math.abs(mod360(wheelStopRotation(1, 4)) - mod360(-135)) < 0.001
);
const spunAngle = nextWheelRotation(-45, 1, 4, 4);
check(
  "the wheel keeps spinning forward",
  spunAngle > -45 && Math.abs(mod360(spunAngle) - mod360(wheelStopRotation(1, 4))) < 0.001
);
check("a fresh draw starts on the first name", wheelPlan(1_000_000, 1_000_000, 4, 1000).phase === "spin" && wheelPlan(1_000_000, 1_000_000, 4, 1000).donePairs === 0);
check("two landings finish a team", wheelPlan(1_002_000, 1_000_000, 4, 1000).index === 2 && wheelPlan(1_002_000, 1_000_000, 4, 1000).donePairs === 1);
check("a finished draw has every pair", wheelPlan(1_004_000, 1_000_000, 4, 1000).phase === "done" && wheelPlan(1_004_000, 1_000_000, 4, 1000).donePairs === 2);

function cup(title, specs) {
  const db = {
    users: specs.map(([name, avg], index) => ({ id: index + 1, name, avg })),
    tournaments: [],
  };
  const created = createTournament(db, { id: 1 }, { title, format: "doubles", partnerMode: "even", startsAt: "2026-12-01T19:00", tz: "UTC" });
  for (const user of db.users) signupTournament(db, created.tournament.id, user);
  return { db, id: created.tournament.id };
}
const wheelCup = cup("Wheel Cup", [
  ["Ada Ace", 90],
  ["Bea Bolt", 80],
  ["Cal Cue", 70],
  ["Dee Dart", 60],
  ["Eve Edge", 50],
  ["Fay Flight", 40],
  ["Gil Ghost", 30],
  ["Hap Hold", 20],
]);
const spunTeams = balanceTournamentTeams(wheelCup.db, wheelCup.id, { rng: identityRng });
const reveal = spunTeams.tournament.wheelReveal;
const pairKey = (pair) => pair.map(Number).slice().sort((a, b) => a - b).join("-");
check(
  "even teams land on the highest average with the lowest",
  spunTeams.status === 200 && reveal.order.join(",") === "1,8,2,7,3,6,4,5" && reveal.pairs.map(pairKey).sort().join("|") === "1-8|2-7|3-6|4-5"
);
const guestWheel = publicTournament(wheelCup.db, spunTeams.tournament, null, { detail: true });
const svg = wheelSvg(guestWheel.wheel.players);
check(
  "players can see every signed-up name on the wheel",
  guestWheel.wheel.players.length === 8 && guestWheel.wheel.reveal.order.length === 8 && wheelCup.db.users.every((user) => svg.includes(user.name))
);
check("wheel text escapes names", wheelSvg([{ userId: 1, name: "A & B <C>" }]).includes("A &amp; B &lt;C&gt;"));
const drawnWheel = generateTournamentBracket(wheelCup.db, wheelCup.id);
const semi = drawnWheel.tournament.bracket.rounds[0].matches.find((match) => match.status === "pending");
const won = recordTournamentResult(wheelCup.db, wheelCup.id, semi.id, { winnerTeamId: semi.teamAId });
const finalMatch = drawnWheel.tournament.bracket.rounds.at(-1).matches[0];
const advanced = finalMatch.teamAId === semi.teamAId || finalMatch.teamBId === semi.teamAId;
check(
  "a win with no score moves that side on",
  won.status === 200 && semi.status === "complete" && semi.scoreA == null && semi.scoreB == null && advanced
);
const afterBracket = publicTournament(wheelCup.db, drawnWheel.tournament, null, { detail: true });
check("a generated bracket replaces the wheel", afterBracket.wheel == null && afterBracket.bracket.rounds.length === 2);

const oddCup = cup("Odd Cup", [
  ["High Hand", 90],
  ["Mid Hand", 50],
  ["Low Hand", 20],
]);
const oddTeams = balanceTournamentTeams(oddCup.db, oddCup.id, { rng: identityRng });
check(
  "an odd field sits the middle average out of the spin",
  oddTeams.status === 200 && oddTeams.tournament.wheelReveal.order.join(",") === "1,3" && oddTeams.tournament.wheelReveal.satOut[0].userId === 2
);
const leaving = withdrawTournament(oddCup.db, oddCup.id, oddCup.db.users[0]);
check("a drawn player leaving clears the spin", leaving.status === 200 && leaving.tournament.wheelReveal == null);

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

let seq = 0;
async function register(port, name, avg) {
  seq += 1;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}${seq}`;
  const res = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name,
      email: `${slug}@test.com`,
      password: "pass1234",
      regional: "international",
      dartcounterName: `${slug}DC`,
      avg,
    },
  });
  return res;
}

function teamBands(team) {
  return (team.players || []).map((player) => player.band).sort();
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-tournaments-"));
const port = 21000 + Math.floor(Math.random() * 2000);
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

  const guestList = await api(port, "/api/tournaments");
  check("guests can open the tournament list", guestList.status === 200 && guestList.data.ok && guestList.data.tournaments.length === 0);
  check("guests cannot manage tournaments", guestList.data.canManage === false);
  const guestPost = await api(port, "/api/admin/tournaments", {
    method: "POST",
    body: { title: "Nope", format: "singles", startsAt: "2026-12-01T19:00", tz: "America/New_York" },
  });
  check("guests cannot post", guestPost.status === 401);

  const ownerLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", ownerLogin.status === 200 && Boolean(ownerLogin.data.token));
  const owner = ownerLogin.data.token;

  const player = await register(port, "Pat Player", 55);
  check("player registers", player.status === 200 && Boolean(player.data.token));
  const playerTok = player.data.token;
  const playerPost = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: playerTok,
    body: { title: "Player cup", format: "singles", startsAt: "2026-12-01T19:00", tz: "America/New_York" },
  });
  check("players cannot post", playerPost.status === 403);

  const admin = await register(port, "Dee Admin", 48);
  const assigned = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: owner,
    body: { userId: admin.data.user.id, leagueId: 9 },
  });
  check("owner assigns a division admin", assigned.status === 200);
  const adminPost = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: admin.data.token,
    body: {
      title: "Admin Open",
      format: "singles",
      startsAt: "2026-12-05T18:00",
      tz: "America/New_York",
      description: "Posted by a division admin",
      bestOf: 5,
    },
  });
  check("division admins can post", adminPost.status === 200 && adminPost.data.tournament.title === "Admin Open");
  check(
    "a division admin's tournament is only their division",
    (adminPost.data.tournament.leagueIds || []).join() === "9" && adminPost.data.tournament.entryLabel === "Division 1 only"
  );
  const otherDivision = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: admin.data.token,
    body: { title: "Wrong division", format: "singles", startsAt: "2026-12-06T18:00", tz: "UTC", leagueIds: [10] },
  });
  check("a division admin cannot post another division", otherDivision.status === 400);
  const divisionGuest = await register(port, "Outside Division", 55);
  const adminEventId = adminPost.data.tournament.id;
  const deniedEntry = await api(port, `/api/tournaments/${adminEventId}/signup`, { method: "POST", token: divisionGuest.data.token, body: {} });
  check("players outside the division cannot enter", deniedEntry.status === 400);
  const placedGuest = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: owner,
    body: { userId: divisionGuest.data.user.id, leagueId: 9 },
  });
  check("owner can place the player in Division 1", placedGuest.status === 200);
  const divisionEntry = await api(port, `/api/tournaments/${adminEventId}/signup`, { method: "POST", token: divisionGuest.data.token, body: {} });
  check("a Division 1 player can enter the admin tournament", divisionEntry.status === 200 && divisionEntry.data.tournament.joined === true);
  const divisionTwo = await register(port, "Division Two", 42);
  await api(port, "/api/admin/place-player", { method: "POST", token: owner, body: { userId: divisionTwo.data.user.id, leagueId: 10 } });
  const wrongDivision = await api(port, `/api/tournaments/${adminEventId}/signup`, { method: "POST", token: divisionTwo.data.token, body: {} });
  check("a Division 2 player cannot enter a Division 1 tournament", wrongDivision.status === 400);

  const later = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Later Open", format: "singles", startsAt: "2026-12-20T19:00", tz: "UTC" },
  });
  const sooner = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: {
      title: "Sooner Open",
      format: "singles",
      startsAt: "2026-12-01T19:00",
      tz: "America/New_York",
      capacity: 2,
      description: "Be on time",
    },
  });
  check("start time is stored in UTC", sooner.data.tournament.startsAt === "2026-12-02T00:00:00.000Z");
  const listed = await api(port, "/api/tournaments");
  const openTitles = listed.data.tournaments.filter((t) => t.status === "open").map((t) => t.title);
  check("open tournaments are soonest first", openTitles.indexOf("Sooner Open") < openTitles.indexOf("Later Open") && openTitles.indexOf("Sooner Open") < openTitles.indexOf("Admin Open"));

  const soonerId = sooner.data.tournament.id;
  const badEdit = await api(port, `/api/admin/tournaments/${soonerId}/update`, {
    method: "POST",
    token: owner,
    body: { title: "Sooner Open", startsAt: "2026-12-01T19:00", tz: "America/New_York", capacity: 1, description: "Be on time" },
  });
  check("player limit is at least 2", badEdit.status === 400);
  const one = await register(port, "Only One", 61);
  const joinedOne = await api(port, `/api/tournaments/${soonerId}/signup`, { method: "POST", token: one.data.token, body: {} });
  check("first player can sign up", joinedOne.status === 200 && joinedOne.data.tournament.joined === true);
  const two = await register(port, "Number Two", 44);
  const joinedTwo = await api(port, `/api/tournaments/${soonerId}/signup`, { method: "POST", token: two.data.token, body: {} });
  check("a second player can take the last spot", joinedTwo.status === 200 && joinedTwo.data.tournament.entryCount === 2);
  const three = await register(port, "Number Three", 52);
  const joinedThree = await api(port, `/api/tournaments/${soonerId}/signup`, { method: "POST", token: three.data.token, body: {} });
  check("full tournament rejects the next player", joinedThree.status === 400);
  const shrink = await api(port, `/api/admin/tournaments/${soonerId}/update`, {
    method: "POST",
    token: owner,
    body: { title: "Sooner Open", startsAt: "2026-12-01T19:00", tz: "America/New_York", capacity: 1, description: "Be on time" },
  });
  check("a limit of 1 is rejected", shrink.status === 400);
  const again = await api(port, `/api/tournaments/${soonerId}/signup`, { method: "POST", token: one.data.token, body: {} });
  check("a player cannot sign up twice", again.status === 400);
  const guestSignup = await api(port, `/api/tournaments/${soonerId}/signup`, { method: "POST", body: {} });
  check("guests must sign in to enter", guestSignup.status === 401);
  const left = await api(port, `/api/tournaments/${soonerId}/withdraw`, { method: "POST", token: one.data.token, body: {} });
  check("a player can leave while signup is open", left.status === 200 && left.data.tournament.entryCount === 1 && left.data.tournament.joined === false);

  const renamed = await api(port, `/api/admin/tournaments/${soonerId}/update`, {
    method: "POST",
    token: owner,
    body: { title: "Friday Open", startsAt: "2026-12-01T19:00", tz: "America/New_York", capacity: "", description: "Friday night", bestOf: 7 },
  });
  check("staff can rename and clear the limit", renamed.status === 200 && renamed.data.tournament.title === "Friday Open" && renamed.data.tournament.capacity == null && renamed.data.tournament.bestOf === 7);

  const singles = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Singles Cup", format: "singles", startsAt: "2026-12-08T20:00", tz: "UTC" },
  });
  const singlesId = singles.data.tournament.id;
  const seeds = [];
  for (const [name, avg] of [
    ["Ava Ace", 90],
    ["Bea Bolt", 70],
    ["Cal Croft", 60],
    ["Dee Dart", 40],
  ]) {
    const person = await register(port, name, avg);
    seeds.push(person);
    const up = await api(port, `/api/tournaments/${singlesId}/signup`, { method: "POST", token: person.data.token, body: {} });
    check(`${name} enters singles`, up.status === 200);
  }
  const tooSoon = await api(port, `/api/admin/tournaments/${singlesId}/bracket`, { method: "POST", token: playerTok, body: {} });
  check("players cannot generate a bracket", tooSoon.status === 403);
  const adminOnOpen = await api(port, `/api/admin/tournaments/${singlesId}/bracket`, { method: "POST", token: admin.data.token, body: {} });
  check("a division admin cannot run an open tournament", adminOnOpen.status === 403);
  const drawn = await api(port, `/api/admin/tournaments/${singlesId}/bracket`, { method: "POST", token: owner, body: {} });
  check("singles bracket generates", drawn.status === 200 && drawn.data.tournament.status === "brackets");
  const firstRound = drawn.data.tournament.bracket.rounds[0];
  const pairings = firstRound.matches.map((match) => [match.teamA?.name, match.teamB?.name].sort().join(" vs "));
  check(
    "highest average plays the lowest",
    pairings.includes("Ava Ace vs Dee Dart") && pairings.includes("Bea Bolt vs Cal Croft")
  );
  const ace = drawn.data.tournament.teams.find((team) => team.name === "Ava Ace");
  check("highest average is seed 1", ace?.seed === 1);
  const closed = await api(port, `/api/tournaments/${singlesId}/signup`, { method: "POST", token: playerTok, body: {} });
  check("signup closes when the bracket is up", closed.status === 400);

  const semi = drawn.data.tournament.bracket.rounds[0].matches.find((match) => match.teamA?.name === "Bea Bolt" || match.teamB?.name === "Bea Bolt");
  const bolt = semi.teamA.name === "Bea Bolt" ? semi.teamA : semi.teamB;
  const badScore = await api(port, `/api/admin/tournaments/${singlesId}/matches/${semi.id}`, {
    method: "POST",
    token: owner,
    body: { winnerTeamId: bolt.id, scoreA: semi.teamAId === bolt.id ? 1 : 4, scoreB: semi.teamAId === bolt.id ? 4 : 1 },
  });
  check("the winner must have the higher score", badScore.status === 400);
  const semiWin = await api(port, `/api/admin/tournaments/${singlesId}/matches/${semi.id}`, {
    method: "POST",
    token: owner,
    body: { winnerTeamId: bolt.id, scoreA: semi.teamAId === bolt.id ? 3 : 1, scoreB: semi.teamAId === bolt.id ? 1 : 3 },
  });
  check("a semifinal result advances the winner", semiWin.status === 200);
  const finalBefore = semiWin.data.tournament.bracket.rounds.at(-1).matches[0];
  check("final is not ready until the other semi is played", !finalBefore.teamA || !finalBefore.teamB);
  const other = drawn.data.tournament.bracket.rounds[0].matches.find((match) => match.id !== semi.id);
  const aceSide = other.teamA.name === "Ava Ace" ? other.teamA : other.teamB;
  const otherWin = await api(port, `/api/admin/tournaments/${singlesId}/matches/${other.id}`, {
    method: "POST",
    token: owner,
    body: {
      winnerTeamId: aceSide.id,
      scoreA: other.teamAId === aceSide.id ? 3 : 0,
      scoreB: other.teamAId === aceSide.id ? 0 : 3,
    },
  });
  const finalMatch = otherWin.data.tournament.bracket.rounds.at(-1).matches[0];
  const finalNames = [finalMatch.teamA?.name, finalMatch.teamB?.name].sort();
  check("final is Ace against Bolt", finalNames.join(" vs ") === "Ava Ace vs Bea Bolt");
  const boltSide = finalMatch.teamA.name === "Bea Bolt" ? finalMatch.teamAId : finalMatch.teamBId;
  const finalWin = await api(port, `/api/admin/tournaments/${singlesId}/matches/${finalMatch.id}`, {
    method: "POST",
    token: owner,
    body: { winnerTeamId: boltSide, scoreA: finalMatch.teamAId === boltSide ? 4 : 2, scoreB: finalMatch.teamAId === boltSide ? 2 : 4 },
  });
  check("final result crowns the winner", finalWin.status === 200 && finalWin.data.tournament.status === "complete" && finalWin.data.tournament.championName === "Bea Bolt");
  const rewrite = await api(port, `/api/admin/tournaments/${singlesId}/matches/${semi.id}`, {
    method: "POST",
    token: owner,
    body: { winnerTeamId: semi.teamAId, scoreA: 3, scoreB: 1 },
  });
  check("a played later round blocks an earlier change", rewrite.status === 400);
  const regen = await api(port, `/api/admin/tournaments/${singlesId}/bracket`, { method: "POST", token: owner, body: { replace: true } });
  check("a bracket with results cannot be regenerated", regen.status === 400);

  const byes = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Bye Cup", format: "singles", startsAt: "2026-12-09T20:00", tz: "UTC" },
  });
  const byeId = byes.data.tournament.id;
  for (const [name, avg] of [
    ["Fay Fly", 90],
    ["Gil Glen", 70],
    ["Hal Hope", 50],
  ]) {
    const person = await register(port, name, avg);
    await api(port, `/api/tournaments/${byeId}/signup`, { method: "POST", token: person.data.token, body: {} });
  }
  const byeDraw = await api(port, `/api/admin/tournaments/${byeId}/bracket`, { method: "POST", token: owner, body: {} });
  const byeMatch = byeDraw.data.tournament.bracket.rounds[0].matches.find((match) => match.status === "bye");
  const playable = byeDraw.data.tournament.bracket.rounds[0].matches.find((match) => match.status === "pending");
  check("a field of three gives the top seed a bye", byeMatch?.teamA?.name === "Fay Fly" || byeMatch?.teamB?.name === "Fay Fly");
  const reportBye = await api(port, `/api/admin/tournaments/${byeId}/matches/${byeMatch.id}`, {
    method: "POST",
    token: owner,
    body: { winnerTeamId: byeMatch.winnerTeamId },
  });
  check("a bye is not scored by hand", reportBye.status === 400);
  const underdog = playable.teamA.name === "Hal Hope" ? playable.teamAId : playable.teamBId;
  const byePath = await api(port, `/api/admin/tournaments/${byeId}/matches/${playable.id}`, {
    method: "POST",
    token: owner,
    body: { winnerTeamId: underdog, scoreA: playable.teamAId === underdog ? 3 : 1, scoreB: playable.teamAId === underdog ? 1 : 3 },
  });
  const byeFinal = byePath.data.tournament.bracket.rounds.at(-1).matches[0];
  check(
    "bye winner meets the first-round winner",
    [byeFinal.teamA?.name, byeFinal.teamB?.name].sort().join(" vs ") === "Fay Fly vs Hal Hope"
  );

  const mixed = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Mixed Doubles", format: "doubles", partnerMode: "random", startsAt: "2026-12-12T19:00", tz: "America/New_York" },
  });
  const mixedId = mixed.data.tournament.id;
  const field = [];
  for (const [name, avg] of [
    ["Ivy Ink", 80],
    ["Jo Jung", 50],
    ["Kit King", 90],
    ["Lee Low", 49.9],
    ["Mo Moss", 30],
  ]) {
    const person = await register(port, name, avg);
    field.push({ name, avg, token: person.data.token, id: person.data.user.id, dartcounterName: person.data.user.dartcounterName });
    const up = await api(port, `/api/tournaments/${mixedId}/signup`, { method: "POST", token: person.data.token, body: {} });
    check(`${name} enters mixed doubles`, up.status === 200 && up.data.tournament.entries.find((entry) => entry.name === name)?.band === (avg >= 50 ? "high" : "low"));
  }
  const ivy = field.find((person) => person.name === "Ivy Ink");
  const bumped = await api(port, "/api/account/profile", {
    method: "POST",
    token: ivy.token,
    body: { name: "Ivy Ink", dartcounterName: ivy.dartcounterName, avg: 10 },
  });
  check("profile average can change after signup", bumped.status === 200 && bumped.data.user.avg === 10);
  const short = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Too Few Mixed", format: "doubles", partnerMode: "random", startsAt: "2026-12-13T19:00", tz: "UTC" },
  });
  const onlyHigh = await register(port, "No Low", 70);
  const onlyLow = await register(port, "No High", 20);
  await api(port, `/api/tournaments/${short.data.tournament.id}/signup`, { method: "POST", token: onlyHigh.data.token, body: {} });
  const onePair = await api(port, `/api/admin/tournaments/${short.data.tournament.id}/bracket`, { method: "POST", token: owner, body: {} });
  check("one player cannot fill a doubles draw", onePair.status === 400);
  await api(port, `/api/tournaments/${short.data.tournament.id}/signup`, { method: "POST", token: onlyLow.data.token, body: {} });
  const stillShort = await api(port, `/api/admin/tournaments/${short.data.tournament.id}/bracket`, { method: "POST", token: owner, body: {} });
  check("a single pair still cannot fill a bracket", stillShort.status === 400);
  const allHigh = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "All High", format: "doubles", partnerMode: "random", startsAt: "2026-12-14T19:00", tz: "UTC" },
  });
  const hiA = await register(port, "High A", 60);
  const hiB = await register(port, "High B", 70);
  await api(port, `/api/tournaments/${allHigh.data.tournament.id}/signup`, { method: "POST", token: hiA.data.token, body: {} });
  await api(port, `/api/tournaments/${allHigh.data.tournament.id}/signup`, { method: "POST", token: hiB.data.token, body: {} });
  const noLowDraw = await api(port, `/api/admin/tournaments/${allHigh.data.tournament.id}/bracket`, { method: "POST", token: owner, body: {} });
  check("random doubles need both average pools", noLowDraw.status === 400 && /50\+/.test(noLowDraw.data.error || ""));

  const mixedDraw = await api(port, `/api/admin/tournaments/${mixedId}/bracket`, { method: "POST", token: owner, body: {} });
  check("mixed doubles draws two pairs and leaves one out", mixedDraw.status === 200 && mixedDraw.data.unpairedCount === 1 && mixedDraw.data.tournament.teams.length === 2);
  const mixedTeams = mixedDraw.data.tournament.teams;
  check(
    "every random pair is 50+ with 50-",
    mixedTeams.every((team) => teamBands(team).join(",") === "high,low")
  );
  check("the player left out is from the bigger pool", mixedDraw.data.tournament.unpaired.length === 1 && mixedDraw.data.tournament.unpaired[0].band === "high");
  const ivyEntry = [...mixedDraw.data.tournament.teams.flatMap((team) => team.players), ...mixedDraw.data.tournament.unpaired].find((player) => player.name === "Ivy Ink");
  check("signup average stays 50+ after the profile change", ivyEntry?.avg === 80 && ivyEntry?.band === "high");
  const randomPartner = await api(port, `/api/tournaments/${mixedId}/partner`, {
    method: "POST",
    token: ivy.token,
    body: { partnerUserId: field[1].id },
  });
  check("random doubles do not take partner requests", randomPartner.status === 400);
  const redraw = await api(port, `/api/admin/tournaments/${mixedId}/bracket`, { method: "POST", token: owner, body: { replace: true } });
  check("staff can redraw before any result", redraw.status === 200 && redraw.data.tournament.teams.every((team) => teamBands(team).join(",") === "high,low"));

  const chosen = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Choose Partners", format: "doubles", partnerMode: "choose", startsAt: "2026-12-18T19:00", tz: "UTC", description: "Pick your own partner" },
  });
  const chooseId = chosen.data.tournament.id;
  const pickers = [];
  for (const [name, avg] of [
    ["Nia North", 80],
    ["Oli Oak", 20],
    ["Pia Pine", 70],
    ["Quin Quill", 75],
  ]) {
    const person = await register(port, name, avg);
    pickers.push({ name, id: person.data.user.id, token: person.data.token });
    await api(port, `/api/tournaments/${chooseId}/signup`, { method: "POST", token: person.data.token, body: {} });
  }
  const [nia, oli, pia, quin] = pickers;
  const early = await api(port, `/api/admin/tournaments/${chooseId}/bracket`, { method: "POST", token: owner, body: {} });
  check("chosen doubles need confirmed pairs", early.status === 400);
  const ask = await api(port, `/api/tournaments/${chooseId}/partner`, { method: "POST", token: nia.token, body: { partnerUserId: oli.id } });
  check("a player can ask a signed-up partner", ask.status === 200 && ask.data.tournament.me.partnerRequestUserId === oli.id);
  const declined = await api(port, `/api/tournaments/${chooseId}/partner/decline`, { method: "POST", token: oli.token, body: { partnerUserId: nia.id } });
  check("the partner can decline", declined.status === 200 && !declined.data.tournament.entries.find((entry) => entry.userId === nia.id)?.partnerRequestUserId);
  await api(port, `/api/tournaments/${chooseId}/partner`, { method: "POST", token: nia.token, body: { partnerUserId: oli.id } });
  const accepted = await api(port, `/api/tournaments/${chooseId}/partner/accept`, { method: "POST", token: oli.token, body: { partnerUserId: nia.id } });
  const niaEntry = accepted.data.tournament.entries.find((entry) => entry.userId === nia.id);
  const oliEntry = accepted.data.tournament.entries.find((entry) => entry.userId === oli.id);
  check("accept confirms both players", niaEntry.confirmedPartnerUserId === oli.id && oliEntry.confirmedPartnerUserId === nia.id);
  const blocked = await api(port, `/api/tournaments/${chooseId}/partner`, { method: "POST", token: nia.token, body: { partnerUserId: pia.id } });
  check("a confirmed player must clear before switching", blocked.status === 400);
  await api(port, `/api/tournaments/${chooseId}/partner`, { method: "POST", token: pia.token, body: { partnerUserId: quin.id } });
  const mutual = await api(port, `/api/tournaments/${chooseId}/partner`, { method: "POST", token: quin.token, body: { partnerUserId: pia.id } });
  const piaEntry = mutual.data.tournament.entries.find((entry) => entry.userId === pia.id);
  check("asking each other confirms the pair", piaEntry.confirmedPartnerUserId === quin.id);
  const chooseDraw = await api(port, `/api/admin/tournaments/${chooseId}/bracket`, { method: "POST", token: owner, body: {} });
  check("chosen pairs become the bracket", chooseDraw.status === 200 && chooseDraw.data.tournament.unpaired.length === 0 && chooseDraw.data.tournament.teams.length === 2);
  const pairIds = chooseDraw.data.tournament.teams.map((team) => team.playerIds.slice().sort((a, b) => a - b).join("-")).sort();
  check(
    "teams are the partners the players picked",
    pairIds.join("|") === [ [nia.id, oli.id].sort((a, b) => a - b).join("-"), [pia.id, quin.id].sort((a, b) => a - b).join("-") ].sort().join("|")
  );
  const higher = chooseDraw.data.tournament.teams.find((team) => team.playerIds.includes(pia.id));
  check("chosen pairs are seeded by combined average", higher?.seed === 1);

  const removed = await api(port, `/api/admin/tournaments/${chooseId}/delete`, { method: "POST", token: owner, body: {} });
  check("staff can remove a tournament", removed.status === 200);
  const gone = await api(port, `/api/tournaments/${chooseId}`);
  check("a removed tournament is gone", gone.status === 404);

  const even = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Even Teams", format: "doubles", partnerMode: "even", startsAt: "2026-12-21T19:00", tz: "UTC" },
  });
  const evenId = even.data.tournament.id;
  const evenField = [];
  for (const [name, avg] of [
    ["Rae High", 90],
    ["Sue Mid", 70],
    ["Ty Low", 40],
    ["Uma Base", 20],
  ]) {
    const person = await register(port, name, avg);
    evenField.push({ name, id: person.data.user.id, token: person.data.token });
    await api(port, `/api/tournaments/${evenId}/signup`, { method: "POST", token: person.data.token, body: {} });
  }
  const evenDraw = await api(port, `/api/admin/tournaments/${evenId}/bracket`, { method: "POST", token: owner, body: {} });
  const evenTeams = evenDraw.data.tournament.teams.map((team) => ({ avg: team.avg, ids: team.playerIds.slice().sort((a, b) => a - b).join("-") }));
  check("even doubles makes two teams with the same average", evenDraw.status === 200 && evenTeams.length === 2 && evenTeams[0].avg === evenTeams[1].avg);
  const rae = evenField.find((person) => person.name === "Rae High");
  const uma = evenField.find((person) => person.name === "Uma Base");
  const sue = evenField.find((person) => person.name === "Sue Mid");
  const ty = evenField.find((person) => person.name === "Ty Low");
  const swapped = await api(port, `/api/admin/tournaments/${evenId}/teams`, {
    method: "POST",
    token: owner,
    body: { teams: [{ playerIds: [rae.id, sue.id] }, { playerIds: [ty.id, uma.id] }] },
  });
  const swappedIds = (swapped.data.tournament.teams || []).map((team) => team.playerIds.slice().sort((a, b) => a - b).join("-")).sort();
  check(
    "staff can edit teams and the bracket follows",
    swapped.status === 200 && swappedIds.join("|") === [[rae.id, sue.id].sort((a, b) => a - b).join("-"), [ty.id, uma.id].sort((a, b) => a - b).join("-")].sort().join("|")
  );
  const evenFinal = swapped.data.tournament.bracket.rounds.at(-1).matches[0];
  const locked = await api(port, `/api/admin/tournaments/${evenId}/matches/${evenFinal.id}`, {
    method: "POST",
    token: owner,
    body: { winnerTeamId: evenFinal.teamAId, scoreA: 2, scoreB: 0 },
  });
  const editAfter = await api(port, `/api/admin/tournaments/${evenId}/teams`, {
    method: "POST",
    token: owner,
    body: { teams: [{ playerIds: [rae.id, uma.id] }, { playerIds: [sue.id, ty.id] }] },
  });
  check("teams lock after a result is saved", locked.status === 200 && editAfter.status === 400);

  const splitDraw = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: {
      title: "Average Pools",
      format: "doubles",
      partnerMode: "even",
      poolMode: "avg",
      avgSplit: 60,
      startsAt: "2026-12-22T19:00",
      tz: "UTC",
    },
  });
  const splitId = splitDraw.data.tournament.id;
  for (const [name, avg] of [
    ["Val 90", 90],
    ["Wes 80", 80],
    ["Xan 70", 70],
    ["Yen 65", 65],
    ["Zed 50", 50],
    ["Amy 40", 40],
    ["Bea 30", 30],
    ["Cyd 20", 20],
  ]) {
    const person = await register(port, name, avg);
    await api(port, `/api/tournaments/${splitId}/signup`, { method: "POST", token: person.data.token, body: {} });
  }
  const pooled = await api(port, `/api/admin/tournaments/${splitId}/bracket`, { method: "POST", token: owner, body: {} });
  const poolNames = (pooled.data.tournament.draws || []).map((draw) => draw.name).sort();
  const poolSeparated = (pooled.data.tournament.draws || []).every((draw) =>
    draw.teams.every((team) => team.players.every((player) => (draw.poolId === "high" ? player.avg >= 60 : player.avg < 60)))
  );
  check("average pools get separate brackets around the chosen cutoff", pooled.status === 200 && poolNames.join("|") === "60+|60-" && poolSeparated);

  const divisionCup = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: {
      title: "Division Pools",
      format: "singles",
      poolMode: "division",
      startsAt: "2026-12-23T19:00",
      tz: "UTC",
      pools: [
        { name: "Divisions 1 & 2", leagueIds: [9, 10] },
        { name: "Divisions 3, 4 & 5", leagueIds: [11, 12, 13] },
      ],
    },
  });
  const divisionId = divisionCup.data.tournament.id;
  const divisionField = [];
  for (const [name, avg, leagueId] of [
    ["Ann One", 80, 9],
    ["Bob Two", 70, 10],
    ["Cal One", 60, 9],
    ["Dee Three", 50, 11],
    ["Eve Three", 40, 11],
  ]) {
    const person = await register(port, name, avg);
    await api(port, "/api/admin/place-player", { method: "POST", token: owner, body: { userId: person.data.user.id, leagueId } });
    divisionField.push({ name, id: person.data.user.id, token: person.data.token });
    const up = await api(port, `/api/tournaments/${divisionId}/signup`, { method: "POST", token: person.data.token, body: {} });
    check(`${name} enters the division pool`, up.status === 200);
  }
  const divisionDraw = await api(port, `/api/admin/tournaments/${divisionId}/bracket`, { method: "POST", token: owner, body: {} });
  const byPool = new Map((divisionDraw.data.tournament.draws || []).map((draw) => [draw.name, draw.teams.flatMap((team) => team.players.map((player) => player.name))]));
  check(
    "division pools keep 1 and 2 apart from 3, 4, and 5",
    divisionDraw.status === 200 &&
      (byPool.get("Divisions 1 & 2") || []).slice().sort().join("|") === "Ann One|Bob Two|Cal One" &&
      (byPool.get("Divisions 3, 4 & 5") || []).slice().sort().join("|") === "Dee Three|Eve Three"
  );

  const blanks = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Blank Cards", format: "doubles", partnerMode: "choose", startsAt: "2026-12-24T19:00", tz: "UTC" },
  });
  const blankId = blanks.data.tournament.id;
  const blankField = [];
  for (const [name, avg] of [
    ["Fay Blank", 80],
    ["Gil Blank", 30],
    ["Hap Blank", 60],
    ["Ivy Blank", 40],
  ]) {
    const person = await register(port, name, avg);
    blankField.push({ name, id: person.data.user.id });
    await api(port, `/api/tournaments/${blankId}/signup`, { method: "POST", token: person.data.token, body: {} });
  }
  const openCards = await api(port, `/api/tournaments/${blankId}`, { token: owner });
  const cardSeats = (openCards.data.tournament.teamCards || []).map((card) => card.playerIds);
  check(
    "choose-your-partner starts each player on a card with a blank seat",
    openCards.status === 200 && cardSeats.length === 4 && cardSeats.every((ids) => ids.filter(Boolean).length === 1)
  );
  const [fay, gil, hap, ivyBlank] = blankField;
  const filled = await api(port, `/api/admin/tournaments/${blankId}/teams`, {
    method: "POST",
    token: owner,
    body: { teams: [{ playerIds: [fay.id, gil.id] }, { playerIds: [hap.id, ivyBlank.id] }] },
  });
  check("staff can fill the blank seats", filled.status === 200 && filled.data.tournament.teamEdits === true);
  const blankDraw = await api(port, `/api/admin/tournaments/${blankId}/bracket`, { method: "POST", token: owner, body: {} });
  const blankPairs = (blankDraw.data.tournament.teams || []).map((team) => team.playerIds.slice().sort((a, b) => a - b).join("-")).sort();
  check(
    "filled blank cards become the teams",
    blankDraw.status === 200 &&
      blankDraw.data.tournament.unpaired.length === 0 &&
      blankPairs.join("|") === [[fay.id, gil.id].sort((a, b) => a - b).join("-"), [hap.id, ivyBlank.id].sort((a, b) => a - b).join("-")].sort().join("|")
  );

  const cutoff = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Cutoff 70", format: "doubles", partnerMode: "random", avgSplit: 70, startsAt: "2026-12-25T19:00", tz: "UTC" },
  });
  const cutoffId = cutoff.data.tournament.id;
  for (const [name, avg] of [
    ["Jet 80", 80],
    ["Kim 75", 75],
    ["Lux 60", 60],
    ["Max 40", 40],
  ]) {
    const person = await register(port, name, avg);
    const up = await api(port, `/api/tournaments/${cutoffId}/signup`, { method: "POST", token: person.data.token, body: {} });
    const entry = up.data.tournament.entries.find((item) => item.name === name);
    check(`${name} uses the selected cutoff`, up.status === 200 && entry.band === (avg >= 70 ? "high" : "low"));
  }
  const cutoffDraw = await api(port, `/api/admin/tournaments/${cutoffId}/bracket`, { method: "POST", token: owner, body: {} });
  check(
    "random doubles honors the selected cutoff",
    cutoffDraw.status === 200 && cutoffDraw.data.tournament.teams.every((team) => team.players.some((player) => player.avg >= 70) && team.players.some((player) => player.avg < 70))
  );

  const detail = await api(port, `/api/tournaments/${mixedId}`, { token: owner });
  check("detail includes the bracket", detail.status === 200 && detail.data.tournament.bracket.rounds.length >= 1 && detail.data.tournament.canManage === true);

  const wheelNight = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: owner,
    body: { title: "Wheel Night", format: "doubles", partnerMode: "even", startsAt: "2026-12-26T19:00", tz: "UTC" },
  });
  const wheelId = wheelNight.data.tournament.id;
  const wheelField = [];
  for (const [name, avg] of [
    ["Nell 90", 90],
    ["Omar 70", 70],
    ["Pia 40", 40],
    ["Quin 20", 20],
  ]) {
    const person = await register(port, name, avg);
    wheelField.push({ name, id: person.data.user.id, token: person.data.token });
    await api(port, `/api/tournaments/${wheelId}/signup`, { method: "POST", token: person.data.token, body: {} });
  }
  const guestWheelPage = await api(port, `/api/tournaments/${wheelId}`);
  check(
    "guests see the signup wheel before the draw",
    guestWheelPage.status === 200 && guestWheelPage.data.tournament.wheel.players.length === 4 && guestWheelPage.data.tournament.wheel.reveal == null
  );
  const spunHttp = await api(port, `/api/admin/tournaments/${wheelId}/teams/balance`, { method: "POST", token: owner, body: {} });
  const httpPairs = (spunHttp.data.tournament.wheel?.reveal?.pairs || [])
    .map((pair) => pair.map(Number).slice().sort((a, b) => a - b).join("-"))
    .sort();
  const wheelNell = wheelField.find((person) => person.name === "Nell 90");
  const wheelOmar = wheelField.find((person) => person.name === "Omar 70");
  const wheelPia = wheelField.find((person) => person.name === "Pia 40");
  const wheelQuin = wheelField.find((person) => person.name === "Quin 20");
  const expectedPairs = [
    [wheelNell.id, wheelQuin.id].sort((a, b) => a - b).join("-"),
    [wheelOmar.id, wheelPia.id].sort((a, b) => a - b).join("-"),
  ].sort();
  check(
    "make even teams publishes a spin for players",
    spunHttp.status === 200 && spunHttp.data.tournament.wheel.reveal.order.length === 4 && httpPairs.join("|") === expectedPairs.join("|")
  );
  const playerWheel = await api(port, `/api/tournaments/${wheelId}`, { token: wheelNell.token });
  check(
    "a signed-up player sees every name on the wheel",
    playerWheel.status === 200 && playerWheel.data.tournament.wheel.players.map((player) => player.name).sort().join("|") === "Nell 90|Omar 70|Pia 40|Quin 20"
  );
  const wheelBracket = await api(port, `/api/admin/tournaments/${wheelId}/bracket`, { method: "POST", token: owner, body: {} });
  const wheelFinal = wheelBracket.data.tournament.bracket?.rounds?.at(-1)?.matches?.[0];
  const wheelWin = await api(port, `/api/admin/tournaments/${wheelId}/matches/${wheelFinal?.id}`, {
    method: "POST",
    token: owner,
    body: { winnerTeamId: wheelFinal?.teamAId },
  });
  check(
    "generating the bracket removes the wheel and a win needs no score",
    wheelBracket.status === 200 &&
      wheelBracket.data.tournament.wheel == null &&
      wheelWin.status === 200 &&
      wheelWin.data.tournament.status === "complete" &&
      wheelWin.data.tournament.bracket.rounds.at(-1).matches[0].scoreA == null &&
      wheelWin.data.tournament.bracket.rounds.at(-1).matches[0].winnerTeamId === wheelFinal.teamAId
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
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\ntournament tests passed");
