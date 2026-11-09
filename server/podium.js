// Home-page winners podium.
// A bracket's final winner is 1st. The other finalist is 2nd when that final
// was played. 3rd is the only player who lost in the round that feeds the
// final. Two semifinal losers are not ranked, because this site has no
// third-place match, unless the tournament stores an explicit 3rd-place pair.
// That pair shares the one 3rd step and is preferred over the semifinal rule.
// The main page features the most recently completed tournament that has a winner.

export function placesFromBracket(bracket) {
  const rounds = Array.isArray(bracket?.rounds) ? bracket.rounds : [];
  if (!rounds.length) return null;
  const finalMatch = rounds[rounds.length - 1]?.matches?.[0];
  if (!finalMatch) return null;
  const played = finalMatch.status === "complete" || finalMatch.status === "bye";
  const first = played ? idOf(finalMatch.winnerTeamId) : null;
  if (!first) return null;
  let second = null;
  if (finalMatch.status === "complete" && finalMatch.teamAId && finalMatch.teamBId) {
    const other = finalMatch.winnerTeamId === finalMatch.teamAId ? finalMatch.teamBId : finalMatch.teamAId;
    second = idOf(other);
    if (second === first) second = null;
  }
  const third = thirdPlace(rounds, first, second);
  return {
    first,
    second,
    third: third.teamId,
    thirdNote: third.note,
  };
}

function idOf(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function thirdPlace(rounds, first, second) {
  if (rounds.length < 2) return { teamId: null, note: "" };
  const prev = rounds[rounds.length - 2];
  const losers = [];
  let undecided = false;
  for (const match of prev?.matches || []) {
    if (!match || match.status === "bye" || match.status === "empty") continue;
    if (match.status !== "complete" || !match.teamAId || !match.teamBId || !match.winnerTeamId) {
      undecided = true;
      continue;
    }
    const loser = match.winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
    const id = idOf(loser);
    if (id && id !== idOf(match.winnerTeamId)) losers.push(id);
  }
  if (undecided || losers.length !== 1) {
    return { teamId: null, note: losers.length > 1 ? "No third-place match" : "" };
  }
  const teamId = losers[0];
  if (!teamId || teamId === first || teamId === second) return { teamId: null, note: "" };
  return { teamId, note: "" };
}

function drawList(tournament) {
  if (Array.isArray(tournament?.draws) && tournament.draws.length) return tournament.draws.filter((draw) => draw?.bracket);
  if (tournament?.bracket) return [{ poolId: "all", name: "", teams: tournament.teams || [], bracket: tournament.bracket }];
  return [];
}

function teamsOf(draw, tournament) {
  if (Array.isArray(draw?.teams) && draw.teams.length) return draw.teams;
  return Array.isArray(tournament?.teams) ? tournament.teams : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function podiumPlayer(user, fallbackId) {
  const real = clean(user?.name);
  const nick = clean(user?.nickname);
  const name = (real || nick || (user ? "Player" : "Removed player")).slice(0, 80);
  const showNick = nick && nick.toLowerCase() !== name.toLowerCase() ? nick.slice(0, 80) : "";
  const userId = user?.id != null ? Number(user.id) : fallbackId ? Number(fallbackId) : null;
  const id = Number.isFinite(userId) ? userId : null;
  return {
    userId: id,
    name,
    nickname: showNick,
    hasAvatar: Boolean(user?.avatarFile),
    avatarUrl: user?.avatarFile && id ? `/api/users/${id}/avatar?v=${encodeURIComponent(user.avatarUpdatedAt || "1")}` : "",
  };
}

function playersFor(db, team) {
  const ids = (team?.playerIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return [{ userId: null, name: "Player", nickname: "", hasAvatar: false, avatarUrl: "" }];
  return ids.map((id) => podiumPlayer((db.users || []).find((user) => Number(user.id) === id) || null, id));
}

function playersFromIds(db, ids) {
  return ids.map((id) => podiumPlayer((db.users || []).find((user) => Number(user.id) === Number(id)) || null, id));
}

// Staff can name two players who share 3rd. A stored pair wins over the
// semifinal inference. One board uses it when the tournament has a single
// draw, or when the saved pool matches that draw.
function explicitThirdIds(tournament, draw) {
  const saved = tournament?.thirdPlace;
  if (!saved || typeof saved !== "object" || !Array.isArray(saved.playerIds)) return null;
  const ids = [];
  for (const raw of saved.playerIds) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === 2) break;
  }
  if (ids.length !== 2) return null;
  const draws = drawList(tournament);
  if (draws.length > 1) {
    const poolId = String(saved.poolId || "");
    const drawPool = String(draw?.poolId || "all");
    if (!poolId || poolId !== drawPool) return null;
  }
  return ids;
}

function placePayload(place, teamId, db, teams, note) {
  if (!teamId) return { place, players: [], note: note || "" };
  const team = teams.find((item) => String(item.id) === String(teamId));
  const players = team ? playersFor(db, team) : [];
  if (!players.length) return { place, players: [], note: note || "" };
  return { place, players, note: "" };
}

function boardFor(db, tournament, draw) {
  const picked = placesFromBracket(draw?.bracket);
  if (!picked?.first) return null;
  const teams = teamsOf(draw, tournament);
  const explicitIds = explicitThirdIds(tournament, draw);
  const third = explicitIds
    ? { place: 3, players: playersFromIds(db, explicitIds), note: "" }
    : placePayload(3, picked.third, db, teams, picked.thirdNote);
  const places = [
    placePayload(1, picked.first, db, teams, ""),
    placePayload(2, picked.second, db, teams, ""),
    third,
  ];
  if (!places[0].players.length) return null;
  return {
    poolId: draw.poolId || "all",
    poolName: clean(draw.name),
    places,
  };
}

function timeOf(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : null;
}

function compareTournaments(a, b) {
  const aDone = a.status === "complete" ? 1 : 0;
  const bDone = b.status === "complete" ? 1 : 0;
  if (aDone !== bDone) return bDone - aDone;
  const keys = (tournament) => [timeOf(tournament.completedAt), timeOf(tournament.generatedAt), timeOf(tournament.startsAt), timeOf(tournament.createdAt), Number(tournament.id) || 0];
  const ak = keys(a);
  const bk = keys(b);
  for (let i = 0; i < ak.length; i++) {
    const av = ak[i] ?? -Infinity;
    const bv = bk[i] ?? -Infinity;
    if (av !== bv) return bv - av;
  }
  return 0;
}

function eventFor(db, tournament) {
  const boards = drawList(tournament)
    .map((draw) => boardFor(db, tournament, draw))
    .filter(Boolean);
  if (!boards.length) return null;
  const finished = timeOf(tournament.completedAt) != null ? new Date(tournament.completedAt).toISOString() : null;
  return {
    id: Number(tournament.id),
    title: clean(tournament.title) || "Tournament",
    status: tournament.status || "",
    finishedAt: finished,
    startsAt: tournament.startsAt || null,
    format: tournament.format || "",
    boards,
  };
}

export function homePodium(db) {
  const events = (Array.isArray(db?.tournaments) ? db.tournaments : [])
    .slice()
    .sort(compareTournaments)
    .map((tournament) => eventFor(db, tournament))
    .filter(Boolean)
    .slice(0, 8);
  return { events };
}
