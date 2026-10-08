// Injured players stay in the division. Their fixtures become a vacancy
// that the next placed player can fill. A return before that closes it.
// Run: `node server/injured-list.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { sheetsRows } from "./sheetsExport.js";
import { standingsForLeague } from "./standings.js";
import { injuredLeagueIds } from "./injury.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const sheetDb = {
  regionals: [{ id: 3, fullTitle: "TSH International" }],
  leagues: [{ id: 9, regionalId: 3, name: "Division 1" }],
  users: [
    {
      id: 1,
      name: "Ira Hurt",
      email: "ira@test.com",
      avg: 50,
      leagueIds: [9],
      injuredLeagueIds: [9],
      regionalChoice: "international",
    },
  ],
  fixtures: [
    {
      id: 1,
      leagueId: 9,
      status: "played",
      homeId: 1,
      awayId: 2,
      homeLegs: 4,
      awayLegs: 2,
      homeAvg: 58,
      awayAvg: 40,
      home180: 1,
      away180: 0,
    },
  ],
};
const sheetPlayers = sheetsRows(sheetDb, "players");
check(
  "sheets status is Injured and the division stays listed",
  sheetPlayers[0]?.Status === "Injured" && String(sheetPlayers[0]?.Divisions || "").includes("Division 1")
);
const flagged = standingsForLeague(
  {
    ...sheetDb,
    users: [
      ...sheetDb.users,
      { id: 2, name: "Opp Stay", avg: 40, leagueIds: [9] },
    ],
  },
  9
);
const ira = flagged.find((row) => row.playerId === 1);
check(
  "an injured player stays on the table with their result",
  ira?.injured === true && ira?.won === 1 && ira?.points === 6 && ira?.legsFor === 4 && ira?.oneEighties === 1 && ira?.avg === 58
);
check(
  "an injury flag for a division they left is ignored",
  injuredLeagueIds({ leagueIds: [9], injuredLeagueIds: [9, 10] }).join(",") === "9"
);

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-injured-list-"));
const port = 19000 + Math.floor(Math.random() * 2000);
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
    return created.data.league?.id;
  }

  async function addPlayer(name, avg) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const created = await api(port, "/api/auth/register", {
      method: "POST",
      body: {
        name,
        email: `${slug}-injury@test.com`,
        password: "pass1234",
        regional: "international",
        dartcounterName: `${slug}-dc`,
        avg,
      },
    });
    check(`register ${name}`, created.status === 200 && created.data.user?.id && created.data.token);
    return { id: created.data.user?.id, token: created.data.token };
  }

  async function place(userId, leagueId) {
    const placed = await api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId, leagueId },
    });
    check(`placed ${userId} in ${leagueId}`, placed.status === 200 && (placed.data.user?.leagueIds || []).includes(leagueId));
    return placed;
  }

  const leagueId = await addDivision("Injury Div");
  const ada = await addPlayer("Ada Injury", 55);
  const bea = await addPlayer("Bea Opponent", 50);
  const cal = await addPlayer("Cal Played", 48);
  const dee = await addPlayer("Dee Newcomer", 44);
  const eve = await addPlayer("Eve Head", 42);
  await place(ada.id, leagueId);
  await place(bea.id, leagueId);
  await place(cal.id, leagueId);

  const openMatch = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: ada.id, awayId: bea.id, week: 1, date: "2026-11-02", season: 1 },
  });
  check("unplayed fixture created", openMatch.status === 200 && openMatch.data.fixture?.id);
  const openId = openMatch.data.fixture?.id;

  const playedMatch = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: ada.id, awayId: cal.id, week: 2, date: "2026-10-01", season: 1 },
  });
  const playedId = playedMatch.data.fixture?.id;
  const scored = await api(port, `/api/admin/fixtures/${playedId}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 2, homeAvg: 61.2, awayAvg: 55.4, homeOneEighties: 1, awayOneEighties: 2 },
  });
  check("played result published", scored.status === 200 && scored.data.fixture?.status === "played");

  const asked = await api(port, "/api/account/league-request", {
    method: "POST",
    token: ada.token,
    body: { kind: "injury", leagueId, note: "Shoulder" },
  });
  check("player can ask for the injured list", asked.status === 200 && asked.data.request?.kind === "injury");
  check(
    "they stay placed until an admin confirms",
    (asked.data.user?.leagueIds || []).includes(leagueId) && !(asked.data.user?.injuredLeagueIds || []).includes(leagueId)
  );
  const dup = await api(port, "/api/account/league-request", {
    method: "POST",
    token: ada.token,
    body: { kind: "injury", leagueId },
  });
  check("duplicate injured-list request is blocked", dup.status === 400);

  const playerDenied = await api(port, "/api/admin/injury", {
    method: "POST",
    token: ada.token,
    body: { userId: ada.id, leagueId },
  });
  check("a player cannot update the injured list", playerDenied.status === 403);

  const madeHead = await api(port, "/api/admin/assign-head-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: eve.id },
  });
  check("head admin assigned", madeHead.status === 200);
  const headLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "eve-head-injury@test.com", password: "pass1234" },
  });
  const headTok = headLogin.data.token;
  const headDirect = await api(port, "/api/admin/injury", {
    method: "POST",
    token: headTok,
    body: { userId: ada.id, leagueId },
  });
  check("a head admin cannot place someone directly", headDirect.status === 403 && /owners can update the injured list/i.test(headDirect.data.error || ""));

  const desk = await api(port, "/api/admin/overview", { token: headTok });
  const req = (desk.data.leagueRequests || []).find((item) => item.userId === ada.id && item.kind === "injury");
  check("head admin sees the injured-list request", Boolean(req?.id));
  const resolved = await api(port, "/api/admin/league-requests/resolve", {
    method: "POST",
    token: headTok,
    body: { id: req?.id, action: "done" },
  });
  check(
    "confirming keeps the division and marks them injured",
    resolved.status === 200 &&
      resolved.data.kind === "injury" &&
      (resolved.data.user?.leagueIds || []).includes(leagueId) &&
      (resolved.data.user?.injuredLeagueIds || []).includes(leagueId) &&
      (resolved.data.byes || 0) >= 1
  );
  check("the pending request is cleared", !(resolved.data.user?.pendingLeagueRequests || []).some((item) => item.kind === "injury"));

  const again = await api(port, "/api/account/league-request", {
    method: "POST",
    token: ada.token,
    body: { kind: "injury", leagueId },
  });
  check("already injured blocks another request", again.status === 400);

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  const held = (overview.data.fixtures || []).find((item) => item.id === openId);
  const kept = (overview.data.fixtures || []).find((item) => item.id === playedId);
  check(
    "the unplayed match is a bye that can be filled",
    held?.status === "bye" && held?.homeId == null && Number(held?.awayId) === bea.id && (held?.injuryHolds || []).some((hold) => Number(hold.userId) === ada.id)
  );
  check("the played fixture is part of the vacancy until someone is placed", kept?.status === "played" && Number(kept?.homeId) === ada.id && Number(kept?.homeLegs) === 5);
  const adaSeat = (overview.data.openSeats || []).find((seat) => Number(seat.userId) === ada.id && Number(seat.leagueId) === leagueId);
  check(
    "their fixtures open one vacancy",
    Boolean(adaSeat?.id) && (adaSeat.matches || 0) >= 1 && (adaSeat.playedMatches || 0) >= 1
  );

  const table = await api(port, `/api/leagues/${leagueId}`);
  const adaRow = (table.data.standings || []).find((row) => row.playerId === ada.id);
  check(
    "standings keep the injured player and their record",
    adaRow?.injured === true && adaRow?.won === 1 && adaRow?.points === 7 && adaRow?.legsFor === 5 && adaRow?.oneEighties === 1 && adaRow?.avg === 61.2
  );

  const blockedFixture = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: ada.id, awayId: bea.id, week: 3, date: "2026-11-16", season: 1 },
  });
  check("a new fixture cannot assign an injured player", blockedFixture.status === 400 && /injured list/i.test(blockedFixture.data.error || ""));

  const cleared = await api(port, "/api/admin/injury/clear", {
    method: "POST",
    token: ownerTok,
    body: { userId: ada.id, leagueId },
  });
  const restoredView = await api(port, "/api/admin/overview", { token: ownerTok });
  const restored = (restoredView.data.fixtures || []).find((item) => item.id === openId);
  check(
    "returning them before the spot is filled puts them back and closes it",
    cleared.status === 200 &&
      (cleared.data.restored || 0) >= 1 &&
      !(cleared.data.user?.injuredLeagueIds || []).includes(leagueId) &&
      (cleared.data.user?.leagueIds || []).includes(leagueId) &&
      Number(restored?.homeId) === ada.id &&
      restored?.status === "scheduled" &&
      !(restoredView.data.openSeats || []).some((seat) => Number(seat.userId) === ada.id && Number(seat.leagueId) === leagueId)
  );

  const direct = await api(port, "/api/admin/injury", {
    method: "POST",
    token: ownerTok,
    body: { userId: ada.id, leagueId },
  });
  const reopened = await api(port, "/api/admin/overview", { token: ownerTok });
  check(
    "an owner can place them directly and open the spot again",
    direct.status === 200 &&
      (direct.data.user?.injuredLeagueIds || []).includes(leagueId) &&
      (direct.data.byes || 0) >= 1 &&
      (reopened.data.openSeats || []).some((seat) => Number(seat.userId) === ada.id && Number(seat.leagueId) === leagueId)
  );
  const repeat = await api(port, "/api/admin/injury", {
    method: "POST",
    token: ownerTok,
    body: { userId: ada.id, leagueId },
  });
  check("placing them twice is blocked", repeat.status === 400);

  const filled = await place(dee.id, leagueId);
  const afterFill = await api(port, "/api/admin/overview", { token: ownerTok });
  const taken = (afterFill.data.fixtures || []).find((item) => item.id === openId);
  const playedAfter = (afterFill.data.fixtures || []).find((item) => item.id === playedId);
  const adaAfter = (afterFill.data.users || []).find((user) => user.id === ada.id);
  check(
    "a later placement fills that vacancy",
    (filled.data.filledSeat?.matches || 0) >= 1 &&
      (filled.data.filledSeat?.playedRenamed || 0) >= 1 &&
      Number(taken?.homeId) === dee.id &&
      Number(taken?.awayId) === bea.id &&
      taken?.status === "scheduled" &&
      playedAfter?.status === "played" &&
      Number(playedAfter?.homeId) === dee.id &&
      Number(playedAfter?.homeLegs) === 5 &&
      !(afterFill.data.openSeats || []).some((seat) => Number(seat.userId) === ada.id && Number(seat.leagueId) === leagueId)
  );
  check(
    "the injured player stays in the division",
    (adaAfter?.leagueIds || []).includes(leagueId) && (adaAfter?.injuredLeagueIds || []).includes(leagueId)
  );
  const back = await api(port, "/api/admin/injury/clear", {
    method: "POST",
    token: ownerTok,
    body: { userId: ada.id, leagueId },
  });
  const afterReturn = await api(port, "/api/admin/overview", { token: ownerTok });
  const keptMatch = (afterReturn.data.fixtures || []).find((item) => item.id === openId);
  check(
    "returning after the spot is filled leaves that match with the new player",
    back.status === 200 &&
      (back.data.restored || 0) === 0 &&
      !(back.data.user?.injuredLeagueIds || []).includes(leagueId) &&
      (back.data.user?.leagueIds || []).includes(leagueId) &&
      Number(keptMatch?.homeId) === dee.id
  );

  const drawId = await addDivision("Injury Draw");
  const fay = await addPlayer("Fay Draw", 51);
  const gus = await addPlayer("Gus Draw", 49);
  const hal = await addPlayer("Hal Draw", 47);
  await place(fay.id, drawId);
  await place(gus.id, drawId);
  const fayAsk = await api(port, "/api/account/league-request", {
    method: "POST",
    token: fay.token,
    body: { kind: "injury", leagueId: drawId },
  });
  const fayDirect = await api(port, "/api/admin/injury", {
    method: "POST",
    token: ownerTok,
    body: { userId: fay.id, leagueId: drawId },
  });
  const fayMe = await api(port, "/api/auth/me", { token: fay.token });
  const fayDesk = await api(port, "/api/admin/overview", { token: ownerTok });
  check("a direct place clears the pending request", fayAsk.status === 200 && fayDirect.status === 200 && !(fayMe.data.user?.pendingLeagueRequests || []).some((item) => item.kind === "injury"));
  check(
    "no remaining matches means no open spot",
    !(fayDesk.data.openSeats || []).some((seat) => Number(seat.userId) === fay.id)
  );
  const shortDraw = await api(port, "/api/admin/fixtures/generate", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: drawId, season: 1, startDate: "2026-11-01" },
  });
  const stillThere = await api(port, "/api/auth/me", { token: fay.token });
  check(
    "a draw skips an injured player and keeps their spot",
    shortDraw.status === 400 &&
      /injured list/i.test(shortDraw.data.error || "") &&
      (stillThere.data.user?.leagueIds || []).includes(drawId) &&
      (stillThere.data.user?.injuredLeagueIds || []).includes(drawId)
  );
  await place(hal.id, drawId);
  const drawn = await api(port, "/api/admin/fixtures/generate", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: drawId, season: 1, startDate: "2026-11-01" },
  });
  const created = drawn.data.fixtures || [];
  check(
    "the next draw includes the available players only",
    drawn.status === 200 &&
      created.length >= 1 &&
      created.every((fixture) => Number(fixture.homeId) !== fay.id && Number(fixture.awayId) !== fay.id)
  );
  const fayStill = await api(port, "/api/auth/me", { token: fay.token });
  check("the injured player is still in that division after the draw", (fayStill.data.user?.leagueIds || []).includes(drawId));

  const drop = await api(port, "/api/account/league-request", {
    method: "POST",
    token: gus.token,
    body: { kind: "drop", leagueId: drawId },
  });
  const dropReq = ((await api(port, "/api/admin/overview", { token: ownerTok })).data.leagueRequests || []).find(
    (item) => item.userId === gus.id && item.kind === "drop"
  );
  const dropped = await api(port, "/api/admin/league-requests/resolve", {
    method: "POST",
    token: ownerTok,
    body: { id: dropReq?.id, action: "done" },
  });
  check(
    "withdraw still removes them from the division",
    drop.status === 200 && dropped.status === 200 && dropped.data.kind === "drop" && !(dropped.data.user?.leagueIds || []).includes(drawId)
  );

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check(
    "player hub offers the injured list beside withdraw",
    appJs.includes("INJURED LIST") && appJs.includes('value="injury"') && appJs.includes("ASK TO WITHDRAW") && appJs.includes("DROPLEAGUE")
  );
  check(
    "owner desk can place and return someone",
    appJs.includes('data-form="INJURE"') && appJs.includes('data-form="CLEARINJURY"') && appJs.includes("PLACE ON INJURED LIST") && appJs.includes("RETURN")
  );
  check("league requests can confirm an injured-list ask", appJs.includes("INJURED LIST — ALL LEAGUES") && appJs.includes("LEAGUERESOLVE"));
  check("standings label an injured row", appJs.includes("row.injured"));
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
console.log("\nAll injured-list checks passed.");
