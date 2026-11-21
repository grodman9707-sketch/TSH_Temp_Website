// Winners podium: who finished 1st, 2nd, and 3rd. Home shows that podium for 48 hours.
// Run: `node server/podium.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { PODIUM_HOME_MS, homePodium, placesFromBracket } from "./podium.js";
import { createTournament, generateTournamentBracket, hideHomePodium, recordTournamentResult, setTournamentThirdPlace, signupTournament } from "./tournaments.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

function finalBye(teamId) {
  return { rounds: [{ matches: [{ status: "bye", teamAId: teamId, teamBId: null, winnerTeamId: teamId }] }] };
}

function playedFinal(winner, loser) {
  return {
    rounds: [{ matches: [{ status: "complete", teamAId: winner, teamBId: loser, winnerTeamId: winner }] }],
  };
}

const pending = placesFromBracket({
  rounds: [{ matches: [{ status: "pending", teamAId: "t1", teamBId: "t2", winnerTeamId: null }] }],
});
check("a final that has not been played has no places", pending == null);

const byeOnly = placesFromBracket(finalBye("t1"));
check("a bye into the title gives 1st only", byeOnly?.first === "t1" && byeOnly.second == null && byeOnly.third == null && byeOnly.thirdNote === "");

const four = placesFromBracket({
  rounds: [
    {
      matches: [
        { status: "complete", teamAId: "t1", teamBId: "t4", winnerTeamId: "t1" },
        { status: "complete", teamAId: "t2", teamBId: "t3", winnerTeamId: "t2" },
      ],
    },
    { matches: [{ status: "complete", teamAId: "t1", teamBId: "t2", winnerTeamId: "t1" }] },
  ],
});
check(
  "two semifinal losers are not ranked as 3rd",
  four?.first === "t1" && four.second === "t2" && four.third == null && four.thirdNote === "No third-place match"
);

const three = placesFromBracket({
  rounds: [
    {
      matches: [
        { status: "bye", teamAId: "t1", teamBId: null, winnerTeamId: "t1" },
        { status: "complete", teamAId: "t2", teamBId: "t3", winnerTeamId: "t3" },
      ],
    },
    { matches: [{ status: "complete", teamAId: "t1", teamBId: "t3", winnerTeamId: "t1" }] },
  ],
});
check("the only semifinal loser is 3rd", three?.first === "t1" && three.second === "t3" && three.third === "t2" && three.thirdNote === "");

const names = homePodium({
  users: [
    { id: 1, name: "Nina North", nickname: "Nines", email: "nina@secret.test", avatarFile: "nina.png", avatarUpdatedAt: "9" },
    { id: 2, name: "", nickname: "Solo", email: "solo@secret.test" },
    { id: 3, name: "Pat Pine", nickname: "pat pine", email: "pat@secret.test" },
    { id: 4, name: "Quinn Quill", nickname: "Q", email: "quinn@secret.test" },
  ],
  tournaments: [
    {
      id: 7,
      title: "Pairs Finals",
      status: "complete",
      format: "doubles",
      completedAt: "2026-11-01T20:00:00.000Z",
      startsAt: "2026-11-01T18:00:00.000Z",
      teams: [
        { id: "t1", playerIds: [1, 2] },
        { id: "t2", playerIds: [3, 4] },
        { id: "t3", playerIds: [99] },
      ],
      bracket: {
        rounds: [
          {
            matches: [
              { status: "complete", teamAId: "t1", teamBId: "t3", winnerTeamId: "t1" },
              { status: "bye", teamAId: "t2", teamBId: null, winnerTeamId: "t2" },
            ],
          },
          { matches: [{ status: "complete", teamAId: "t1", teamBId: "t2", winnerTeamId: "t1" }] },
        ],
      },
    },
  ],
}, Date.parse("2026-11-02T20:00:00.000Z"));
const pairs = names.events[0];
const firstPlayers = pairs?.boards[0].places[0].players;
const secondPlayers = pairs?.boards[0].places[1].players;
const thirdPlayers = pairs?.boards[0].places[2].players;
check("doubles podium keeps both players and the real name first", firstPlayers?.map((p) => p.name).join(" & ") === "Nina North & Solo");
check("nickname sits under a different real name", firstPlayers?.[0].nickname === "Nines" && firstPlayers?.[0].hasAvatar === true && firstPlayers?.[0].avatarUrl === "/api/users/1/avatar?v=9");
check("a missing real name uses the nickname and does not repeat it", firstPlayers?.[1].name === "Solo" && firstPlayers?.[1].nickname === "");
check("a nickname that matches the real name is not repeated", secondPlayers?.[0].name === "Pat Pine" && secondPlayers?.[0].nickname === "");
check("runner-up keeps a distinct nickname", secondPlayers?.[1].name === "Quinn Quill" && secondPlayers?.[1].nickname === "Q");
check("a removed player still fills the 3rd step", thirdPlayers?.[0].name === "Removed player");
check("podium payload does not include emails", !JSON.stringify(names).includes("secret.test"));

const splitDb = {
  users: [
    { id: 1, name: "High Hopper", nickname: "" },
    { id: 3, name: "Low Lark", nickname: "" },
    { id: 4, name: "Low Lynx", nickname: "" },
  ],
  tournaments: [
    {
      id: 3,
      title: "Older Cup",
      status: "complete",
      completedAt: "2026-11-01T20:00:00.000Z",
      startsAt: "2026-08-01T18:00:00.000Z",
      teams: [
        { id: "t1", playerIds: [1] },
        { id: "t2", playerIds: [3] },
      ],
      bracket: playedFinal("t1", "t2"),
    },
    {
      id: 8,
      title: "Split Open",
      status: "complete",
      format: "singles",
      completedAt: "2026-11-02T20:00:00.000Z",
      startsAt: "2026-11-02T18:00:00.000Z",
      draws: [
        {
          poolId: "high",
          name: "50+",
          teams: [{ id: "high-t1", playerIds: [1] }],
          bracket: finalBye("high-t1"),
        },
        {
          poolId: "low",
          name: "50-",
          teams: [
            { id: "low-t1", playerIds: [3] },
            { id: "low-t2", playerIds: [4] },
          ],
          bracket: playedFinal("low-t1", "low-t2"),
        },
      ],
    },
    {
      id: 99,
      title: "Still Going",
      status: "brackets",
      startsAt: "2026-12-20T18:00:00.000Z",
      generatedAt: "2026-12-20T12:00:00.000Z",
      draws: [
        { poolId: "a", name: "Pool A", teams: [{ id: "a1", playerIds: [1] }], bracket: finalBye("a1") },
        {
          poolId: "b",
          name: "Pool B",
          teams: [
            { id: "b1", playerIds: [3] },
            { id: "b2", playerIds: [4] },
          ],
          bracket: { rounds: [{ matches: [{ status: "pending", teamAId: "b1", teamBId: "b2", winnerTeamId: null }] }] },
        },
      ],
    },
    {
      id: 4,
      title: "Signup Only",
      status: "open",
      startsAt: "2026-12-01T18:00:00.000Z",
      entries: [],
    },
  ],
};
const splitNow = Date.parse("2026-11-03T20:00:00.000Z");
const split = homePodium(splitDb, splitNow);
check(
  "the most recently finished tournament is the home podium",
  split.events.length === 1 && split.events[0]?.title === "Split Open" && split.events[0].finishedAt === "2026-11-02T20:00:00.000Z"
);
check("an older finish at 48 hours is left off the home podium", split.events.every((event) => event.title !== "Older Cup"));
check("an unfinished tournament is not a home winners podium", split.events.every((event) => event.title !== "Still Going"));
check("signup with no winner is left off the podium", split.events.every((event) => event.title !== "Signup Only"));
const aged = homePodium(splitDb, Date.parse("2026-11-06T21:00:00.000Z"));
check("winners leave the home page after 48 hours", PODIUM_HOME_MS === 48 * 60 * 60 * 1000 && aged.events.length === 0);
const boards = split.events[0].boards;
check(
  "each finished pool keeps its own podium",
  boards.map((board) => board.poolName).join(",") === "50+,50-" &&
    boards[0].places[0].players[0].name === "High Hopper" &&
    boards[0].places[1].players.length === 0 &&
    boards[1].places[0].players[0].name === "Low Lark" &&
    boards[1].places[1].players[0].name === "Low Lynx" &&
    boards[1].places[2].players.length === 0
);
check("no tournaments is an empty podium list", homePodium({ users: [], tournaments: [] }).events.length === 0);
check("a bracket with no final winner is skipped", homePodium({
  users: [{ id: 1, name: "Ada Archer" }],
  tournaments: [{ id: 1, title: "Live", status: "brackets", teams: [{ id: "t1", playerIds: [1] }, { id: "t2", playerIds: [1] }], bracket: { rounds: [{ matches: [{ status: "pending", teamAId: "t1", teamBId: "t2", winnerTeamId: null }] }] } }],
}).events.length === 0);

const memory = { users: [], tournaments: [] };
function addUser(name, nickname, avg) {
  const user = { id: memory.users.length + 1, name, nickname, avg, email: `${nickname}@secret.test` };
  memory.users.push(user);
  return user;
}
const ada = addUser("Ada Archer", "Ace", 90);
const bea = addUser("Bea Birch", "Bolt", 70);
const cal = addUser("Cal Crowe", "Chip", 50);
const dee = addUser("Dee Dale", "Dart", 40);
const autumn = createTournament(memory, { id: 1 }, { title: "Autumn Cup", format: "singles", startsAt: "2026-10-01T18:00", tz: "UTC" });
for (const user of [ada, bea, cal]) signupTournament(memory, autumn.tournament.id, user);
generateTournamentBracket(memory, autumn.tournament.id);
let cup = memory.tournaments.find((item) => item.id === autumn.tournament.id);
const semi = cup.bracket.rounds[0].matches.find((match) => match.status === "pending");
recordTournamentResult(memory, cup.id, semi.id, {
  winnerTeamId: semi.teamBId,
  scoreA: semi.teamAId === semi.teamBId ? 3 : 1,
  scoreB: semi.teamAId === semi.teamBId ? 1 : 3,
});
cup = memory.tournaments.find((item) => item.id === autumn.tournament.id);
const finalMatch = cup.bracket.rounds.at(-1).matches[0];
const champion = finalMatch.teamAId;
recordTournamentResult(memory, cup.id, finalMatch.id, {
  winnerTeamId: champion,
  scoreA: finalMatch.teamAId === champion ? 4 : 2,
  scoreB: finalMatch.teamAId === champion ? 2 : 4,
});
cup = memory.tournaments.find((item) => item.id === autumn.tournament.id);
const winterUsers = [ada, bea, cal, dee];
const winter = createTournament(memory, { id: 1 }, { title: "Winter Cup", format: "singles", startsAt: "2026-12-01T18:00", tz: "UTC" });
for (const user of winterUsers) signupTournament(memory, winter.tournament.id, user);
generateTournamentBracket(memory, winter.tournament.id);
let winterCup = memory.tournaments.find((item) => item.id === winter.tournament.id);
for (const match of winterCup.bracket.rounds[0].matches) {
  recordTournamentResult(memory, winterCup.id, match.id, { winnerTeamId: match.teamAId, scoreA: 3, scoreB: 1 });
}
winterCup = memory.tournaments.find((item) => item.id === winter.tournament.id);
const winterFinal = winterCup.bracket.rounds.at(-1).matches[0];
recordTournamentResult(memory, winterCup.id, winterFinal.id, { winnerTeamId: winterFinal.teamAId, scoreA: 4, scoreB: 2 });
winterCup = memory.tournaments.find((item) => item.id === winter.tournament.id);
cup.completedAt = "2029-12-30T12:00:00.000Z";
winterCup.completedAt = "2030-01-01T00:00:00.000Z";
const played = homePodium(memory, Date.parse("2030-01-01T12:00:00.000Z"));
const featured = played.events[0];
const namesOf = (place) => (featured.boards[0].places.find((item) => item.place === place)?.players || []).map((player) => player.name);
check("a played 4-player final records a finish time", Boolean(winterCup.completedAt) && winterCup.status === "complete");
check("home podium features the later finish, not the later signup", featured?.title === "Winter Cup" && played.events.length === 1);
check(
  "1st and 2nd come from the final and 3rd stays open",
  namesOf(1)[0] === "Ada Archer" && namesOf(2)[0] === "Bea Birch" && featured.boards[0].places[2].players.length === 0 && featured.boards[0].places[2].note === "No third-place match"
);
const autumnOnly = homePodium(memory, Date.parse(cup.completedAt) + 60 * 60 * 1000);
const autumnEvent = autumnOnly.events.find((event) => event.title === "Autumn Cup");
const autumnPlaces = autumnEvent.boards[0].places;
check(
  "a 3-player bracket names 1st, 2nd, and the semifinal loser as 3rd",
  autumnPlaces[0].players[0].name === "Ada Archer" &&
    autumnPlaces[0].players[0].nickname === "Ace" &&
    autumnPlaces[1].players[0].name === "Cal Crowe" &&
    autumnPlaces[2].players[0].name === "Bea Birch" &&
    autumnPlaces[2].note === ""
);

const joint = homePodium({
  users: [
    { id: 1, name: "Nina North", nickname: "Nines" },
    { id: 2, name: "Pat Pine", nickname: "" },
    { id: 11, name: "Allan Sargent", nickname: "Al", avatarFile: "allan.png", avatarUpdatedAt: "3", email: "allan@secret.test" },
    { id: 12, name: "Steve Wren", nickname: "Steve Wren", email: "steve@secret.test" },
  ],
  tournaments: [
    {
      id: 15,
      title: "Played Open",
      status: "complete",
      completedAt: "2026-11-08T21:00:00.000Z",
      teams: [
        { id: "t1", playerIds: [1] },
        { id: "t2", playerIds: [2] },
        { id: "t3", playerIds: [11] },
        { id: "t4", playerIds: [12] },
      ],
      bracket: {
        rounds: [
          {
            matches: [
              { status: "complete", teamAId: "t1", teamBId: "t3", winnerTeamId: "t1" },
              { status: "complete", teamAId: "t2", teamBId: "t4", winnerTeamId: "t2" },
            ],
          },
          { matches: [{ status: "complete", teamAId: "t1", teamBId: "t2", winnerTeamId: "t1" }] },
        ],
      },
      thirdPlace: { playerIds: [11, 12] },
    },
  ],
}, Date.parse("2026-11-09T21:00:00.000Z"));
const jointPlaces = joint.events[0]?.boards[0].places || [];
const jointThird = jointPlaces.find((item) => item.place === 3);
check(
  "an explicit 3rd-place pair is one step",
  joint.events[0]?.title === "Played Open" &&
    jointPlaces.length === 3 &&
    jointPlaces.filter((item) => item.place === 3).length === 1 &&
    jointThird?.players?.map((player) => player.name).join(" & ") === "Allan Sargent & Steve Wren" &&
    jointThird.note === ""
);
check(
  "the pair keeps real names, a distinct nickname, and an avatar",
  jointThird?.players?.[0].nickname === "Al" &&
    jointThird.players[0].hasAvatar === true &&
    jointThird.players[0].avatarUrl === "/api/users/11/avatar?v=3" &&
    jointThird.players[1].name === "Steve Wren" &&
    jointThird.players[1].nickname === ""
);
check("explicit 3rd does not change the final", jointPlaces[0].players[0].name === "Nina North" && jointPlaces[1].players[0].name === "Pat Pine");
check("explicit 3rd payload does not include emails", !JSON.stringify(joint).includes("secret.test"));

const pooledThird = homePodium({
  users: [
    { id: 1, name: "High Hopper" },
    { id: 3, name: "Low Lark" },
    { id: 4, name: "Low Lynx" },
    { id: 11, name: "Allan Sargent" },
    { id: 12, name: "Steve Wren" },
  ],
  tournaments: [
    {
      id: 8,
      title: "Split Bronze",
      status: "complete",
      completedAt: "2026-11-02T20:00:00.000Z",
      thirdPlace: { playerIds: [11, 12], poolId: "low" },
      draws: [
        {
          poolId: "high",
          name: "50+",
          teams: [{ id: "high-t1", playerIds: [1] }],
          bracket: finalBye("high-t1"),
        },
        {
          poolId: "low",
          name: "50-",
          teams: [
            { id: "low-t1", playerIds: [3] },
            { id: "low-t2", playerIds: [4] },
            { id: "low-t3", playerIds: [11] },
            { id: "low-t4", playerIds: [12] },
          ],
          bracket: {
            rounds: [
              {
                matches: [
                  { status: "complete", teamAId: "low-t1", teamBId: "low-t3", winnerTeamId: "low-t1" },
                  { status: "complete", teamAId: "low-t2", teamBId: "low-t4", winnerTeamId: "low-t2" },
                ],
              },
              { matches: [{ status: "complete", teamAId: "low-t1", teamBId: "low-t2", winnerTeamId: "low-t1" }] },
            ],
          },
        },
      ],
    },
  ],
}, Date.parse("2026-11-03T20:00:00.000Z"));
const pooledBoards = pooledThird.events[0]?.boards || [];
const highThird = pooledBoards.find((board) => board.poolName === "50+")?.places?.find((item) => item.place === 3);
const lowThird = pooledBoards.find((board) => board.poolName === "50-")?.places?.find((item) => item.place === 3);
check(
  "an explicit pair applies only to the saved bracket",
  lowThird?.players?.map((player) => player.name).join(" & ") === "Allan Sargent & Steve Wren" &&
    lowThird.note === "" &&
    highThird?.players?.length === 0 &&
    highThird.note === ""
);

const bronzeDb = {
  users: [
    { id: 11, name: "Allan Sargent", nickname: "Al" },
    { id: 12, name: "Steve Wren", nickname: "" },
    { id: 9, name: "Outsider Owen", nickname: "" },
  ],
  tournaments: [
    {
      id: 4,
      title: "Friday Cup",
      status: "complete",
      completedAt: "2026-11-06T21:00:00.000Z",
      entries: [{ userId: 11 }],
      teams: [
        { id: "t1", playerIds: [11] },
        { id: "t2", playerIds: [12] },
      ],
      bracket: playedFinal("t1", "t2"),
    },
  ],
};
const bronzeNow = Date.parse("2026-11-07T21:00:00.000Z");
check("a player outside the tournament cannot be named 3rd", setTournamentThirdPlace(bronzeDb, 4, { playerIds: [11, 9] }).status === 400);
check("3rd place needs two different players", setTournamentThirdPlace(bronzeDb, 4, { playerIds: [11, 11] }).status === 400);
const storedPair = setTournamentThirdPlace(bronzeDb, 4, { playerIds: [12, 11] });
const storedStep = homePodium(bronzeDb, bronzeNow).events[0]?.boards[0].places.find((item) => item.place === 3);
check(
  "a placed player and a signed-up player can be stored as one 3rd step",
  storedPair.status === 200 &&
    storedPair.tournament.thirdPlace.playerIds.join(",") === "12,11" &&
    storedStep?.players?.map((player) => player.name).join(" & ") === "Steve Wren & Allan Sargent" &&
    homePodium(bronzeDb, bronzeNow).events[0].boards[0].places.length === 3
);
const clearedPair = setTournamentThirdPlace(bronzeDb, 4, { clear: true });
const clearedStep = homePodium(bronzeDb, bronzeNow).events[0]?.boards[0].places.find((item) => item.place === 3);
check("clearing the pair restores the bracket rule", clearedPair.status === 200 && bronzeDb.tournaments[0].thirdPlace == null && clearedStep?.players?.length === 0);
const splitSave = {
  users: bronzeDb.users,
  tournaments: [
    {
      id: 6,
      title: "Two Brackets",
      status: "complete",
      entries: [{ userId: 11 }, { userId: 12 }],
      draws: [
        { poolId: "high", name: "50+", teams: [{ id: "h", playerIds: [11] }], bracket: finalBye("h") },
        { poolId: "low", name: "50-", teams: [{ id: "a", playerIds: [11] }, { id: "b", playerIds: [12] }], bracket: playedFinal("a", "b") },
      ],
    },
  ],
};
check("a split tournament needs the bracket for the pair", setTournamentThirdPlace(splitSave, 6, { playerIds: [11, 12] }).status === 400);
check(
  "the pair can be saved on one bracket",
  setTournamentThirdPlace(splitSave, 6, { playerIds: [11, 12], poolId: "low" }).tournament?.thirdPlace?.poolId === "low"
);

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
check(
  "the home page renders the winners podium only while the window is open",
  appJs.includes('id="tournament-winners"') &&
    appJs.includes("function homePodium") &&
    appJs.includes('api("/api/podium")') &&
    appJs.includes('if (!events.length) return "";') &&
    !appJs.includes("Winners will appear here") &&
    appJs.includes("Winners stay on this page for 48 hours.") &&
    !appJs.includes("Winners will appear here") &&
    appJs.includes("Remove winners from Home") &&
    appJs.includes("REMOVE WINNERS FROM HOME") &&
    appJs.includes('data-form="TOURNAMENTHOMEPODIUM"') &&
    appJs.includes("The winners post is already off the Home page.") &&
    appJs.includes("data-podium-confetti") &&
    css.includes(".home-podium") &&
    css.includes(".podium-congrats") &&
    css.includes(".podium-place-1") &&
    css.includes(".podium-place-1 .podium-block") &&
    css.includes("height: 8.5rem") &&
    css.includes("prefers-reduced-motion") &&
    css.includes(".podium-fx")
);
const windowBase = Date.parse("2026-11-01T00:00:00.000Z");
const windowUsers = [{ id: 1, name: "Ada Archer" }, { id: 2, name: "Bea Birch" }];
function windowCup(id, title, completedAt) {
  return {
    id,
    title,
    status: "complete",
    completedAt,
    teams: [
      { id: "t1", playerIds: [1] },
      { id: "t2", playerIds: [2] },
    ],
    bracket: playedFinal("t1", "t2"),
  };
}
const windowDb = {
  users: windowUsers,
  tournaments: [
    windowCup(1, "Window Cup", new Date(windowBase).toISOString()),
    windowCup(2, "Later Cup", new Date(windowBase + 6 * 60 * 60 * 1000).toISOString()),
    windowCup(3, "Undated Cup", undefined),
  ],
};
delete windowDb.tournaments[2].completedAt;
const freshWindow = homePodium(windowDb, windowBase + PODIUM_HOME_MS - 1);
check(
  "winners newer than 48 hours are included on the home podium",
  freshWindow.events.length === 1 && freshWindow.events[0].title === "Later Cup" && freshWindow.events[0].finishedAt === windowDb.tournaments[1].completedAt
);
const replaced = homePodium(windowDb, windowBase + 7 * 60 * 60 * 1000);
check(
  "a newer tournament replaces an older one that is still inside 48 hours",
  replaced.events.length === 1 && replaced.events[0].title === "Later Cup"
);
const exactWindow = homePodium(windowDb, windowBase + 6 * 60 * 60 * 1000 + PODIUM_HOME_MS);
check("winners at 48 hours are excluded from the home podium", exactWindow.events.length === 0);
const olderOnly = homePodium(
  { users: windowUsers, tournaments: [windowDb.tournaments[0]] },
  windowBase + PODIUM_HOME_MS - 1
);
check(
  "the latest podium still inside 48 hours is the one that shows",
  olderOnly.events.length === 1 && olderOnly.events[0].title === "Window Cup"
);
check(
  "a finished tournament with no completion time stays off the home page",
  homePodium({ users: windowUsers, tournaments: [windowDb.tournaments[2]] }, windowBase).events.length === 0
);
check(
  "no qualifying winners means no home podium",
  homePodium(windowDb, windowBase + 6 * 60 * 60 * 1000 + PODIUM_HOME_MS + 1).events.length === 0
);
check(
  "48 hours is an absolute duration from the stored completion instant",
  PODIUM_HOME_MS === 48 * 60 * 60 * 1000 &&
    new Date(windowBase + PODIUM_HOME_MS).toISOString() === "2026-11-03T00:00:00.000Z"
);
const dismissDb = {
  users: windowUsers.map((user) => ({ ...user })),
  tournaments: [
    windowCup(1, "Kept Cup", new Date(windowBase).toISOString()),
    windowCup(2, "Dismissed Cup", new Date(windowBase + 60 * 60 * 1000).toISOString()),
  ],
};
dismissDb.tournaments[1].entries = [{ userId: 1 }, { userId: 2 }];
dismissDb.tournaments[1].thirdPlace = { playerIds: [2, 1] };
const dismissNow = windowBase + 2 * 60 * 60 * 1000;
const beforeDismiss = homePodium(dismissDb, dismissNow);
const dismissedCup = dismissDb.tournaments[1];
const keptStamp = dismissedCup.completedAt;
const keptBracket = JSON.stringify(dismissedCup.bracket);
const keptTeams = JSON.stringify(dismissedCup.teams);
const keptEntries = JSON.stringify(dismissedCup.entries);
const keptThird = JSON.stringify(dismissedCup.thirdPlace);
const keptUsers = JSON.stringify(dismissDb.users);
check(
  "a completed tournament inside 48 hours is on the home podium",
  beforeDismiss.events.length === 1 && beforeDismiss.events[0].title === "Dismissed Cup"
);
const hidden = hideHomePodium(dismissDb, 2);
const afterDismiss = homePodium(dismissDb, dismissNow);
check(
  "an owner dismiss flag takes that podium off Home",
  hidden.status === 200 &&
    hidden.tournament.homePodiumHidden === true &&
    afterDismiss.events.length === 1 &&
    afterDismiss.events[0].title === "Kept Cup"
);
check(
  "dismissing the home post leaves players, results, and the winner",
  dismissedCup.completedAt === keptStamp &&
    dismissedCup.status === "complete" &&
    JSON.stringify(dismissedCup.bracket) === keptBracket &&
    JSON.stringify(dismissedCup.teams) === keptTeams &&
    JSON.stringify(dismissedCup.entries) === keptEntries &&
    JSON.stringify(dismissedCup.thirdPlace) === keptThird &&
    JSON.stringify(dismissDb.users) === keptUsers
);
const again = hideHomePodium(dismissDb, 2);
check(
  "dismissing again stays removed and does not move the clock",
  again.status === 200 && again.tournament.homePodiumHidden === true && again.tournament.completedAt === keptStamp
);
check(
  "dismissing one tournament does not hide a different tournament",
  afterDismiss.events.length === 1 && afterDismiss.events[0].title === "Kept Cup" && dismissDb.tournaments[0].homePodiumHidden !== true
);
dismissDb.tournaments[0].homePodiumHidden = true;
dismissedCup.homePodiumHidden = false;
const newerBack = homePodium(dismissDb, dismissNow);
check(
  "a newer completion still shows when only the older post was removed",
  newerBack.events.length === 1 && newerBack.events[0].title === "Dismissed Cup" && dismissDb.tournaments[0].homePodiumHidden === true
);
check(
  "staff can name a 3rd-place pair without playing a third-place match",
  appJs.includes("3rd place pair") && appJs.includes("No third-place match is required") && appJs.includes('data-form="TOURNAMENTTHIRD"')
);
check(
  "the home page still renders the hero and live numbers",
  appJs.includes("function pageHome") && appJs.includes("TSH In Numbers") && appJs.includes('api("/api/stats")')
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-podium-"));
const port = 23000 + Math.floor(Math.random() * 2000);
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
  const empty = await api(port, "/api/podium");
  check("public podium is empty before any tournament finishes", empty.status === 200 && empty.data.ok === true && Array.isArray(empty.data.events) && empty.data.events.length === 0);

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  const ownerTok = owner.data.token;
  const made = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: ownerTok,
    body: { title: "Friday Cup", format: "singles", startsAt: "2026-11-06T19:00", tz: "UTC" },
  });
  const id = made.data.tournament?.id;
  check("staff can post the cup used by the podium", made.status === 200 && id);
  const people = [
    ["Ada Archer", "Ace", 90],
    ["Bea Birch", "Bolt", 70],
    ["Cal Crowe", "Chip", 50],
  ];
  const tokens = [];
  for (const [name, nickname, avg] of people) {
    const slug = nickname.toLowerCase();
    const person = await api(port, "/api/auth/register", {
      method: "POST",
      body: {
        name,
        nickname,
        email: `${slug}-podium@test.com`,
        password: "pass1234",
        regional: "international",
        dartcounterName: `${slug}-podium`,
        avg,
      },
    });
    check(`${name} can register`, person.status === 200 && person.data.token);
    tokens.push(person.data.token);
    const joined = await api(port, `/api/tournaments/${id}/signup`, { method: "POST", token: person.data.token, body: {} });
    check(`${name} enters`, joined.status === 200);
  }
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const avatar = await api(port, "/api/account/avatar", { method: "POST", token: tokens[0], body: { image: png } });
  check("winner can upload an avatar", avatar.status === 200 && avatar.data.user?.hasAvatar === true);
  const drawn = await api(port, `/api/admin/tournaments/${id}/bracket`, { method: "POST", token: ownerTok, body: {} });
  check("bracket is up", drawn.status === 200 && drawn.data.tournament?.status === "brackets");
  const firstRound = drawn.data.tournament.bracket.rounds[0];
  const playable = firstRound.matches.find((match) => match.status === "pending");
  const chipId = playable.teamA?.name === "Cal Crowe" ? playable.teamAId : playable.teamBId;
  const semiWin = await api(port, `/api/admin/tournaments/${id}/matches/${playable.id}`, {
    method: "POST",
    token: ownerTok,
    body: { winnerTeamId: chipId, scoreA: playable.teamAId === chipId ? 3 : 1, scoreB: playable.teamAId === chipId ? 1 : 3 },
  });
  const final = semiWin.data.tournament.bracket.rounds.at(-1).matches[0];
  const aceId = final.teamA?.name === "Ada Archer" ? final.teamAId : final.teamBId;
  const finalWin = await api(port, `/api/admin/tournaments/${id}/matches/${final.id}`, {
    method: "POST",
    token: ownerTok,
    body: { winnerTeamId: aceId, scoreA: final.teamAId === aceId ? 4 : 2, scoreB: final.teamAId === aceId ? 2 : 4 },
  });
  check("the cup is complete", finalWin.status === 200 && finalWin.data.tournament.status === "complete");
  const podium = await api(port, "/api/podium");
  const event = podium.data.events?.[0];
  const place = (n) => event?.boards?.[0]?.places?.find((item) => item.place === n);
  check("api podium is that finished cup", podium.status === 200 && event?.title === "Friday Cup" && typeof event?.finishedAt === "string" && event.finishedAt.length > 10);
  check(
    "api names 1st, 2nd, and 3rd by real name",
    place(1)?.players?.[0]?.name === "Ada Archer" &&
      place(1).players[0].nickname === "Ace" &&
      place(1).players[0].hasAvatar === true &&
      place(1).players[0].avatarUrl.startsWith("/api/users/") &&
      place(2)?.players?.[0]?.name === "Cal Crowe" &&
      place(2).players[0].nickname === "Chip" &&
      place(3)?.players?.[0]?.name === "Bea Birch" &&
      place(3).players[0].nickname === "Bolt"
  );
  check("api podium does not leak emails", !JSON.stringify(podium.data).includes("@"));
  const beaId = place(3)?.players?.[0]?.userId;
  const calId = place(2)?.players?.[0]?.userId;
  const outsider = await api(port, `/api/admin/tournaments/${id}/third-place`, {
    method: "POST",
    token: ownerTok,
    body: { playerIds: [beaId, 999999] },
  });
  check("staff cannot name a player who is not in the tournament", outsider.status === 400);
  const guest = await api(port, `/api/admin/tournaments/${id}/third-place`, {
    method: "POST",
    body: { playerIds: [beaId, calId] },
  });
  check("guests cannot set 3rd place", guest.status === 401);
  const savedThird = await api(port, `/api/admin/tournaments/${id}/third-place`, {
    method: "POST",
    token: ownerTok,
    body: { playerIds: [beaId, calId] },
  });
  const savedNames = (savedThird.data.tournament?.thirdPlace?.players || []).map((player) => player.name).join(" & ");
  check("staff can save a 3rd-place pair", savedThird.status === 200 && savedNames === "Bea Birch & Cal Crowe");
  const jointPodium = await api(port, "/api/podium");
  const jointPlacesApi = jointPodium.data.events?.[0]?.boards?.[0]?.places || [];
  const jointThirdApi = jointPlacesApi.find((item) => item.place === 3);
  check(
    "the public podium shows that pair on one 3rd step",
    jointPodium.status === 200 &&
      jointPlacesApi.length === 3 &&
      jointPlacesApi.filter((item) => item.place === 3).length === 1 &&
      jointThirdApi?.players?.map((player) => player.name).join(" & ") === "Bea Birch & Cal Crowe" &&
      jointThirdApi.note === "" &&
      jointPlacesApi.find((item) => item.place === 1)?.players?.[0]?.name === "Ada Archer"
  );
  const clearedThird = await api(port, `/api/admin/tournaments/${id}/third-place`, {
    method: "POST",
    token: ownerTok,
    body: { clear: true },
  });
  const restored = await api(port, "/api/podium");
  const restoredThird = restored.data.events?.[0]?.boards?.[0]?.places?.find((item) => item.place === 3);
  check(
    "clearing the pair restores the semifinal 3rd",
    clearedThird.status === 200 &&
      !clearedThird.data.tournament?.thirdPlace &&
      restoredThird?.players?.length === 1 &&
      restoredThird.players[0].name === "Bea Birch"
  );
  const storedBefore = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
  const storedCup = storedBefore.tournaments.find((item) => item.id === id);
  const storedStamp = storedCup.completedAt;
  const storedEntries = JSON.stringify(storedCup.entries);
  const storedBracket = JSON.stringify(storedCup.bracket);
  const playerDismiss = await api(port, `/api/admin/tournaments/${id}/home-podium`, { method: "POST", token: tokens[2], body: {} });
  const stillPosted = await api(port, "/api/podium");
  check(
    "a player cannot remove the home winners post",
    playerDismiss.status === 403 && stillPosted.data.events?.[0]?.title === "Friday Cup"
  );
  const bea = await api(port, "/api/auth/me", { token: tokens[1] });
  const promoted = await api(port, "/api/admin/assign-head-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: bea.data.user?.id },
  });
  const staffDismiss = await api(port, `/api/admin/tournaments/${id}/home-podium`, { method: "POST", token: tokens[1], body: {} });
  const stillPostedAfterStaff = await api(port, "/api/podium");
  check(
    "staff who are not owners cannot remove the home winners post",
    promoted.status === 200 && staffDismiss.status === 403 && stillPostedAfterStaff.data.events?.[0]?.title === "Friday Cup"
  );
  const guestDismiss = await api(port, `/api/admin/tournaments/${id}/home-podium`, { method: "POST", body: {} });
  check("a guest cannot remove the home winners post", guestDismiss.status === 401);
  const removedPost = await api(port, `/api/admin/tournaments/${id}/home-podium`, { method: "POST", token: ownerTok, body: {} });
  const afterRemove = await api(port, "/api/podium");
  const detail = await api(port, `/api/tournaments/${id}`);
  const storedAfter = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
  const storedCupAfter = storedAfter.tournaments.find((item) => item.id === id);
  check(
    "an owner removes that tournament from the home podium only",
    removedPost.status === 200 &&
      removedPost.data.tournament?.homePodiumHidden === true &&
      afterRemove.data.events?.length === 0 &&
      detail.data.tournament?.status === "complete" &&
      detail.data.tournament?.championName === "Ada Archer" &&
      detail.data.tournament?.homePodiumHidden === true &&
      storedCupAfter.completedAt === storedStamp &&
      JSON.stringify(storedCupAfter.entries) === storedEntries &&
      JSON.stringify(storedCupAfter.bracket) === storedBracket &&
      storedAfter.users.length === storedBefore.users.length
  );
  const removedAgain = await api(port, `/api/admin/tournaments/${id}/home-podium`, { method: "POST", token: ownerTok, body: {} });
  const storedTwice = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8")).tournaments.find((item) => item.id === id);
  check(
    "removing the post again stays off Home and keeps the clock",
    removedAgain.status === 200 && storedTwice.homePodiumHidden === true && storedTwice.completedAt === storedStamp
  );
  const later = await api(port, "/api/admin/tournaments", {
    method: "POST",
    token: ownerTok,
    body: { title: "Saturday Cup", format: "singles", startsAt: "2026-11-07T19:00", tz: "UTC" },
  });
  const laterId = later.data.tournament?.id;
  for (const token of tokens) {
    const joined = await api(port, `/api/tournaments/${laterId}/signup`, { method: "POST", token, body: {} });
    if (joined.status !== 200) throw new Error(`later signup ${joined.status}`);
  }
  const laterDrawn = await api(port, `/api/admin/tournaments/${laterId}/bracket`, { method: "POST", token: ownerTok, body: {} });
  const laterPlayable = laterDrawn.data.tournament.bracket.rounds[0].matches.find((match) => match.status === "pending");
  const laterChip = laterPlayable.teamA?.name === "Cal Crowe" ? laterPlayable.teamAId : laterPlayable.teamBId;
  const laterSemi = await api(port, `/api/admin/tournaments/${laterId}/matches/${laterPlayable.id}`, {
    method: "POST",
    token: ownerTok,
    body: { winnerTeamId: laterChip, scoreA: laterPlayable.teamAId === laterChip ? 3 : 1, scoreB: laterPlayable.teamAId === laterChip ? 1 : 3 },
  });
  const laterFinal = laterSemi.data.tournament.bracket.rounds.at(-1).matches[0];
  const laterAce = laterFinal.teamA?.name === "Ada Archer" ? laterFinal.teamAId : laterFinal.teamBId;
  const laterWin = await api(port, `/api/admin/tournaments/${laterId}/matches/${laterFinal.id}`, {
    method: "POST",
    token: ownerTok,
    body: { winnerTeamId: laterAce, scoreA: laterFinal.teamAId === laterAce ? 4 : 2, scoreB: laterFinal.teamAId === laterAce ? 2 : 4 },
  });
  const laterPodium = await api(port, "/api/podium");
  const fridayStill = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8")).tournaments.find((item) => item.id === id);
  check(
    "a newer tournament still posts its own home podium",
    laterWin.data.tournament?.status === "complete" &&
      laterPodium.data.events?.length === 1 &&
      laterPodium.data.events[0].title === "Saturday Cup" &&
      fridayStill.homePodiumHidden === true &&
      fridayStill.completedAt === storedStamp
  );
} catch (err) {
  failures++;
  console.error("  FAIL - suite error:", err.message);
  if (stderr) console.error(stderr);
} finally {
  if (child.exitCode == null) child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll podium checks passed.");
