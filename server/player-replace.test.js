// Removing a player turns their unplayed fixtures into byes. The next player
// placed in that division takes over that seat without regenerating the draw.
// Run: `node server/player-replace.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
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

function leagueFixtures(overview, leagueId) {
  return (overview.data.fixtures || []).filter((f) => Number(f.leagueId) === Number(leagueId));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-player-replace-"));
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

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("place form explains open seats", appJs.includes("takes over the fixtures left behind"));
  check("played results keep their score under the new name", appJs.includes("Played results stay exactly as they are"));
  check("remove form explains byes", appJs.includes("Unplayed matches become byes for the opponent"));
  check("delete form keeps played results", appJs.includes("Played results stay on the record"));

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

  async function addPlayer(name) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const created = await api(port, "/api/auth/register", {
      method: "POST",
      body: {
        name,
        email: `${slug}-replace@test.com`,
        password: "pass1234",
        regional: "international",
        dartcounterName: `${slug}-dc`,
        avg: 48,
      },
    });
    check(`register ${name}`, created.status === 200 && created.data.user?.id && created.data.token);
    return { id: created.data.user.id, token: created.data.token };
  }

  async function place(userId, leagueId) {
    return api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId, leagueId },
    });
  }

  async function addFixture(leagueId, homeId, awayId, week) {
    return api(port, "/api/admin/fixtures", {
      method: "POST",
      token: ownerTok,
      body: { leagueId, homeId, awayId, week, date: "2024-06-03", season: 1 },
    });
  }

  const leagueId = await addDivision("Seat One");
  const alpha = await addPlayer("Alpha Seat");
  const bravo = await addPlayer("Bravo Seat");
  const charlie = await addPlayer("Charlie Seat");
  const delta = await addPlayer("Delta Seat");
  const echo = await addPlayer("Echo Seat");
  for (const player of [alpha, bravo, charlie, echo]) {
    const placed = await place(player.id, leagueId);
    check(`placed ${player.id}`, placed.status === 200 && !placed.data.filledSeat);
  }

  const played = await addFixture(leagueId, alpha.id, bravo.id, 1);
  const open = await addFixture(leagueId, alpha.id, charlie.id, 2);
  check("fixtures created", played.status === 200 && open.status === 200);
  const playedId = played.data.fixture.id;
  const openId = open.data.fixture.id;

  const proposed = await api(port, `/api/fixtures/${openId}/propose`, {
    method: "POST",
    token: alpha.token,
    body: { datetime: "2024-06-11T19:30" },
  });
  check("home player can propose the open match", proposed.status === 200 && proposed.data.fixture?.scheduleStatus === "proposed");

  const scored = await api(port, `/api/admin/fixtures/${playedId}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 2 },
  });
  check("owner confirms a played result", scored.status === 200 && scored.data.fixture?.status === "played");

  const removed = await api(port, "/api/admin/unplace-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: alpha.id, leagueId },
  });
  check("unplace reports one bye", removed.status === 200 && removed.data.byes === 1 && !(removed.data.user?.leagueIds || []).includes(leagueId));

  const afterRemove = await api(port, "/api/admin/overview", { token: ownerTok });
  const removedOpen = leagueFixtures(afterRemove, leagueId).find((f) => f.id === openId);
  const removedPlayed = leagueFixtures(afterRemove, leagueId).find((f) => f.id === playedId);
  check(
    "unplayed match becomes a bye for the opponent",
    removedOpen?.bye === true &&
      removedOpen?.status === "bye" &&
      removedOpen?.homeId == null &&
      removedOpen?.awayId === charlie.id &&
      removedOpen?.homeName === "Bye" &&
      removedOpen?.awayName === "Charlie Seat" &&
      !removedOpen?.proposedDate &&
      !removedOpen?.scheduleStatus
  );
  check(
    "played result stays with the original players",
    removedPlayed?.status === "played" &&
      removedPlayed?.homeId === alpha.id &&
      removedPlayed?.awayId === bravo.id &&
      removedPlayed?.homeLegs === 5 &&
      removedPlayed?.awayLegs === 2
  );
  const seat = (afterRemove.data.openSeats || []).find((s) => s.leagueId === leagueId);
  check(
    "admin desk lists the open seat",
    seat?.playerName === "Alpha Seat" && seat?.matches === 1 && seat?.playedMatches === 1
  );

  const charlieMatches = await api(port, "/api/my-fixtures", { token: charlie.token });
  const charlieBye = (charlieMatches.data.fixtures || []).find((f) => f.id === openId);
  check("opponent sees the bye", charlieBye?.bye === true && charlieBye?.homeName === "Bye");

  const publicLeague = await api(port, `/api/leagues/${leagueId}`);
  const publicBye = (publicLeague.data.fixtures || []).find((f) => f.id === openId);
  check("division page shows the bye", publicBye?.bye === true && publicBye?.homeName === "Bye" && publicBye?.awayName === "Charlie Seat");
  const charlieRow = (publicLeague.data.standings || []).find((row) => row.playerId === charlie.id);
  check("a bye does not add points", charlieRow?.played === 0 && charlieRow?.points === 0);

  const seated = await place(delta.id, leagueId);
  check(
    "next placed player takes the open seat",
    seated.status === 200 && seated.data.filledSeat?.replacedName === "Alpha Seat" && seated.data.filledSeat?.matches === 1
  );
  const afterSeat = await api(port, "/api/admin/overview", { token: ownerTok });
  const inherited = leagueFixtures(afterSeat, leagueId).find((f) => f.id === openId);
  const playedAfter = leagueFixtures(afterSeat, leagueId).find((f) => f.id === playedId);
  check(
    "replacement inherits the unplayed fixture",
    inherited?.id === openId &&
      inherited?.bye === false &&
      inherited?.status === "scheduled" &&
      inherited?.homeId === delta.id &&
      inherited?.awayId === charlie.id &&
      inherited?.homeName === "Delta Seat" &&
      inherited?.week === 2
  );
  check(
    "played result keeps its score and shows the replacement's name",
    playedAfter?.homeId === delta.id &&
      playedAfter?.homeName === "Delta Seat" &&
      playedAfter?.awayId === bravo.id &&
      playedAfter?.status === "played" &&
      playedAfter?.homeLegs === 5 &&
      playedAfter?.awayLegs === 2
  );
  const deltaRow = (await api(port, `/api/leagues/${leagueId}`)).data.standings?.find((row) => row.playerId === delta.id);
  check("the replacement is credited with that played result", deltaRow?.played === 1 && deltaRow?.won === 1);
  check("open seat closes after it is filled", !(afterSeat.data.openSeats || []).some((s) => s.leagueId === leagueId));

  const deltaMatches = await api(port, "/api/my-fixtures", { token: delta.token });
  const deltaFixture = (deltaMatches.data.fixtures || []).find((f) => f.id === openId);
  check("replacement sees the restored match", deltaFixture?.bye === false && deltaFixture?.awayName === "Charlie Seat");

  const pairLeague = await addDivision("Seat Pair");
  const fox = await addPlayer("Fox Seat");
  const gus = await addPlayer("Gus Seat");
  const hale = await addPlayer("Hale Seat");
  const ivy = await addPlayer("Ivy Seat");
  const june = await addPlayer("June Seat");
  for (const player of [fox, gus, hale]) {
    const placed = await place(player.id, pairLeague);
    check(`placed pair player ${player.id}`, placed.status === 200);
  }
  const foxGus = await addFixture(pairLeague, fox.id, gus.id, 1);
  const foxHale = await addFixture(pairLeague, fox.id, hale.id, 2);
  const gusHale = await addFixture(pairLeague, gus.id, hale.id, 3);
  check("pair fixtures created", foxGus.status === 200 && foxHale.status === 200 && gusHale.status === 200);
  const foxGusId = foxGus.data.fixture.id;
  const foxHaleId = foxHale.data.fixture.id;
  const gusHaleId = gusHale.data.fixture.id;

  const foxOut = await api(port, "/api/admin/unplace-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: fox.id, leagueId: pairLeague },
  });
  const gusOut = await api(port, "/api/admin/unplace-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: gus.id, leagueId: pairLeague },
  });
  check("two departures open two seats", foxOut.data.byes === 2 && gusOut.data.byes === 2);
  const bothGone = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), pairLeague).find((f) => f.id === foxGusId);
  check(
    "a match stays when both players leave",
    bothGone?.homeId == null && bothGone?.awayId == null && bothGone?.bye === true && bothGone?.status === "bye"
  );

  const ivyIn = await place(ivy.id, pairLeague);
  check("oldest seat is filled first", ivyIn.data.filledSeat?.replacedName === "Fox Seat" && ivyIn.data.filledSeat?.matches === 2);
  const afterIvy = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), pairLeague);
  const ivyFoxGus = afterIvy.find((f) => f.id === foxGusId);
  const ivyFoxHale = afterIvy.find((f) => f.id === foxHaleId);
  const ivyGusHale = afterIvy.find((f) => f.id === gusHaleId);
  check("first replacement takes only the oldest seat", ivyFoxHale?.homeId === ivy.id && ivyFoxHale?.awayId === hale.id && ivyFoxHale?.status === "scheduled");
  check("mutual fixture stays a bye until the other seat is filled", ivyFoxGus?.homeId === ivy.id && ivyFoxGus?.awayId == null && ivyFoxGus?.bye === true);
  check("the newer seat is untouched", ivyGusHale?.homeId == null && ivyGusHale?.awayId === hale.id && ivyGusHale?.bye === true);

  const juneIn = await place(june.id, pairLeague);
  check("second replacement takes the remaining seat", juneIn.data.filledSeat?.replacedName === "Gus Seat" && juneIn.data.filledSeat?.matches === 2);
  const restored = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), pairLeague);
  const restoredMutual = restored.find((f) => f.id === foxGusId);
  const restoredGusHale = restored.find((f) => f.id === gusHaleId);
  check(
    "both replacements restore the original pairing",
    restoredMutual?.homeId === ivy.id && restoredMutual?.awayId === june.id && restoredMutual?.status === "scheduled" && restoredMutual?.bye === false
  );
  check("second seat restores the other fixture", restoredGusHale?.homeId === june.id && restoredGusHale?.awayId === hale.id && restoredGusHale?.status === "scheduled");

  const returnLeague = await addDivision("Seat Return");
  const red = await addPlayer("Red Seat");
  const blue = await addPlayer("Blue Seat");
  const green = await addPlayer("Green Seat");
  for (const player of [red, blue, green]) await place(player.id, returnLeague);
  const redBlue = await addFixture(returnLeague, red.id, blue.id, 1);
  const redGreen = await addFixture(returnLeague, red.id, green.id, 2);
  await api(port, "/api/admin/unplace-player", { method: "POST", token: ownerTok, body: { userId: red.id, leagueId: returnLeague } });
  await api(port, "/api/admin/unplace-player", { method: "POST", token: ownerTok, body: { userId: blue.id, leagueId: returnLeague } });
  const redBack = await place(red.id, returnLeague);
  check("a returning player gets their own seat back", redBack.data.filledSeat?.replacedName === "Red Seat" && redBack.data.filledSeat?.matches === 2);
  const returned = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), returnLeague);
  const redGreenBack = returned.find((f) => f.id === redGreen.data.fixture.id);
  const redBlueBack = returned.find((f) => f.id === redBlue.data.fixture.id);
  check("returning player is restored against the player who stayed", redGreenBack?.homeId === red.id && redGreenBack?.awayId === green.id && redGreenBack?.status === "scheduled");
  check("the other open seat is still waiting", redBlueBack?.homeId === red.id && redBlueBack?.awayId == null && redBlueBack?.bye === true);
  const seatsLeft = (await api(port, "/api/admin/overview", { token: ownerTok })).data.openSeats || [];
  check("blue's seat is still open", seatsLeft.some((s) => s.leagueId === returnLeague && s.playerName === "Blue Seat"));

  const deleteLeague = await addDivision("Seat Delete");
  const pat = await addPlayer("Pat Seat");
  const quinn = await addPlayer("Quinn Seat");
  const sam = await addPlayer("Sam Seat");
  await place(pat.id, deleteLeague);
  await place(quinn.id, deleteLeague);
  const patPlayed = await addFixture(deleteLeague, pat.id, quinn.id, 1);
  const patOpen = await addFixture(deleteLeague, pat.id, quinn.id, 2);
  await api(port, `/api/admin/fixtures/${patPlayed.data.fixture.id}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 3 },
  });
  const deleted = await api(port, "/api/admin/delete-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: pat.id },
  });
  check("delete reports the open bye", deleted.status === 200 && deleted.data.byes === 1);
  const afterDelete = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), deleteLeague);
  const deletedPlayed = afterDelete.find((f) => f.id === patPlayed.data.fixture.id);
  const deletedOpen = afterDelete.find((f) => f.id === patOpen.data.fixture.id);
  check(
    "deleted player's played match keeps their name and score",
    deletedPlayed?.status === "played" && deletedPlayed?.homeName === "Pat Seat" && deletedPlayed?.homeLegs === 5 && deletedPlayed?.awayLegs === 3
  );
  check("deleted player's open match is a bye", deletedOpen?.bye === true && deletedOpen?.awayId === quinn.id && deletedOpen?.homeName === "Bye");
  const samIn = await place(sam.id, deleteLeague);
  check(
    "a placed player fills the deleted player's seat",
    samIn.data.filledSeat?.replacedName === "Pat Seat" && samIn.data.filledSeat?.matches === 1 && samIn.data.filledSeat?.playedRenamed === 1
  );
  const afterSam = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), deleteLeague);
  const samPlayed = afterSam.find((f) => f.id === patPlayed.data.fixture.id);
  check(
    "new player takes the open fixture and the name on the played result",
    afterSam.find((f) => f.id === patOpen.data.fixture.id)?.homeId === sam.id &&
      samPlayed?.homeId === sam.id &&
      samPlayed?.homeName === "Sam Seat" &&
      samPlayed?.status === "played" &&
      samPlayed?.homeLegs === 5 &&
      samPlayed?.awayLegs === 3
  );

  const dropLeague = await addDivision("Seat Drop");
  const ned = await addPlayer("Ned Seat");
  const ora = await addPlayer("Ora Seat");
  const pip = await addPlayer("Pip Seat");
  await place(ned.id, dropLeague);
  await place(ora.id, dropLeague);
  const dropFixture = await addFixture(dropLeague, ned.id, ora.id, 1);
  const request = await api(port, "/api/account/league-request", {
    method: "POST",
    token: ned.token,
    body: { kind: "drop", leagueId: dropLeague },
  });
  check("player can ask to withdraw", request.status === 200 && request.data.request?.id);
  const dropped = await api(port, "/api/admin/league-requests/resolve", {
    method: "POST",
    token: ownerTok,
    body: { id: request.data.request.id, action: "done" },
  });
  check("dropping a player makes a bye", dropped.status === 200 && dropped.data.byes === 1);
  const pipIn = await place(pip.id, dropLeague);
  const dropRow = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), dropLeague).find((f) => f.id === dropFixture.data.fixture.id);
  check("withdrawn seat is filled by the next player", pipIn.data.filledSeat?.matches === 1 && dropRow?.homeId === pip.id && dropRow?.awayId === ora.id && dropRow?.status === "scheduled");

  const clearLeague = await addDivision("Seat Clear");
  const uma = await addPlayer("Uma Seat");
  const vic = await addPlayer("Vic Seat");
  const wes = await addPlayer("Wes Seat");
  await place(uma.id, clearLeague);
  await place(vic.id, clearLeague);
  await addFixture(clearLeague, uma.id, vic.id, 1);
  await api(port, "/api/admin/unplace-player", { method: "POST", token: ownerTok, body: { userId: uma.id, leagueId: clearLeague } });
  const cleared = await api(port, "/api/admin/fixtures/clear-league", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: clearLeague },
  });
  check("clearing a division removes its fixtures", cleared.status === 200 && cleared.data.removed === 1);
  const wesIn = await place(wes.id, clearLeague);
  const clearOverview = await api(port, "/api/admin/overview", { token: ownerTok });
  check("clearing fixtures also clears the open seat", !wesIn.data.filledSeat && !(clearOverview.data.openSeats || []).some((s) => s.leagueId === clearLeague));
  check("no fixture is invented after the draw is cleared", leagueFixtures(clearOverview, clearLeague).length === 0);

  const fromLeague = await addDivision("Seat From");
  const toLeague = await addDivision("Seat To");
  const mover = await addPlayer("Mover Seat");
  const stay = await addPlayer("Stay Seat");
  const kay = await addPlayer("Kay Seat");
  const lee = await addPlayer("Lee Seat");
  await place(mover.id, fromLeague);
  await place(stay.id, fromLeague);
  await place(kay.id, toLeague);
  await place(lee.id, toLeague);
  const fromFixture = await addFixture(fromLeague, mover.id, stay.id, 1);
  const toFixture = await addFixture(toLeague, kay.id, lee.id, 1);
  await api(port, "/api/admin/unplace-player", { method: "POST", token: ownerTok, body: { userId: kay.id, leagueId: toLeague } });
  const moved = await place(mover.id, toLeague);
  check("moving divisions takes the open seat", moved.status === 200 && moved.data.filledSeat?.replacedName === "Kay Seat" && (moved.data.user?.leagueIds || []).includes(toLeague));
  const fromRow = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), fromLeague).find((f) => f.id === fromFixture.data.fixture.id);
  const toRow = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), toLeague).find((f) => f.id === toFixture.data.fixture.id);
  check("the division they left has a bye", fromRow?.bye === true && fromRow?.awayId === stay.id && fromRow?.homeId == null);
  check("the division they joined uses the existing fixture", toRow?.homeId === mover.id && toRow?.awayId === lee.id && toRow?.status === "scheduled" && toRow?.id === toFixture.data.fixture.id);

  const created = await api(port, "/api/admin/create-player", {
    method: "POST",
    token: ownerTok,
    body: {
      name: "New Seat",
      email: "new-seat-replace@test.com",
      password: "pass1234",
      dartcounterName: "new-seat-dc",
      leagueId: fromLeague,
    },
  });
  const createdRow = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), fromLeague).find((f) => f.id === fromFixture.data.fixture.id);
  check(
    "adding a player into the division fills the open seat",
    created.status === 200 && created.data.filledSeat?.replacedName === "Mover Seat" && createdRow?.homeId === created.data.user?.id && createdRow?.awayId === stay.id && createdRow?.status === "scheduled"
  );

  const byeLeague = await addDivision("Seat Bye");
  const byePlayer = await addPlayer("Bye Holder");
  const byeMate = await addPlayer("Bye Mate");
  await place(byePlayer.id, byeLeague);
  await place(byeMate.id, byeLeague);
  const weekBye = await addFixture(byeLeague, byePlayer.id, "bye", 1);
  const weekMatch = await addFixture(byeLeague, byePlayer.id, byeMate.id, 2);
  check("bye week created", weekBye.status === 200 && weekBye.data.fixture?.bye === true);
  const byeId = weekBye.data.fixture.id;
  await api(port, "/api/admin/unplace-player", { method: "POST", token: ownerTok, body: { userId: byePlayer.id, leagueId: byeLeague } });
  const parked = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), byeLeague).find((f) => f.id === byeId);
  check("a solo bye stays in the draw while that seat is open", parked?.bye === true && parked?.status === "bye" && parked?.homeId == null && parked?.week === 1);
  const byeBack = await place(byePlayer.id, byeLeague);
  const restoredBye = leagueFixtures(await api(port, "/api/admin/overview", { token: ownerTok }), byeLeague);
  check(
    "the same player gets the bye week back with the other match",
    byeBack.data.filledSeat?.matches === 2 &&
      restoredBye.find((f) => f.id === byeId)?.homeId === byePlayer.id &&
      restoredBye.find((f) => f.id === byeId)?.bye === true &&
      restoredBye.find((f) => f.id === weekMatch.data.fixture.id)?.awayId === byeMate.id
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
console.log("\nAll player replacement checks passed.");
