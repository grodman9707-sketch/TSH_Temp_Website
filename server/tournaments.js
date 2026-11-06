// Scheduled tournaments: signup, doubles pairing, and single-elimination brackets.
// Averages of 50.00 and above are the 50+ pool. Anything lower is the 50- pool.

import { isValidTimeZone, wallStringToUtc } from "./timezones.js";

export const AVG_SPLIT = 50;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 2000;

export function avgBand(avg) {
  const n = Number(avg);
  if (!Number.isFinite(n)) return "low";
  return n >= AVG_SPLIT ? "high" : "low";
}

export function bandLabel(band) {
  return band === "high" ? "50+" : "50-";
}

export function shuffle(list, rng = Math.random) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function parseStartsAt(value, timeZone) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/.exec(s);
  if (!local || !isValidTimeZone(timeZone)) return null;
  const d = wallStringToUtc(local[1], local[2], timeZone);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fail(status, error) {
  return { status, error };
}

function nextId(list) {
  return Math.max(0, ...(Array.isArray(list) ? list : []).map((x) => Number(x.id) || 0)) + 1;
}

function ensureList(db) {
  if (!Array.isArray(db.tournaments)) db.tournaments = [];
  return db.tournaments;
}

export function findTournament(db, id) {
  return ensureList(db).find((t) => Number(t.id) === Number(id)) || null;
}

function findUser(db, userId) {
  return (db.users || []).find((u) => Number(u.id) === Number(userId)) || null;
}

function roundAvg(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function playerView(user) {
  const avg = roundAvg(user?.avg);
  const band = avgBand(avg);
  const known = Boolean(user);
  return {
    userId: user?.id != null ? Number(user.id) : null,
    name: String(user?.nickname || user?.name || (known ? "Player" : "Removed player")).slice(0, 80),
    avg,
    band,
    bandLabel: bandLabel(band),
  };
}

function entryAvg(db, entry) {
  if (entry && entry.avg != null && entry.avg !== "") return roundAvg(entry.avg);
  return playerView(findUser(db, entry?.userId)).avg;
}

function entrantView(db, entry) {
  const user = findUser(db, entry.userId);
  const base = playerView(user);
  const avg = entryAvg(db, entry);
  const band = avgBand(avg);
  const partnerId = entry.confirmedPartnerUserId ? Number(entry.confirmedPartnerUserId) : null;
  const requestId = entry.partnerRequestUserId ? Number(entry.partnerRequestUserId) : null;
  const partner = partnerId ? playerView(findUser(db, partnerId)) : null;
  const requested = requestId ? playerView(findUser(db, requestId)) : null;
  return {
    ...base,
    avg,
    band,
    bandLabel: bandLabel(band),
    signedUpAt: entry.signedUpAt || null,
    confirmedPartnerUserId: partnerId,
    partnerName: partner?.name || "",
    partnerRequestUserId: requestId,
    requestedPartnerName: requested?.name || "",
  };
}

export function seedPositions(size) {
  let positions = [1];
  while (positions.length < size) {
    const sum = positions.length * 2 + 1;
    const next = [];
    for (const p of positions) next.push(p, sum - p);
    positions = next;
  }
  return positions;
}

export function roundName(slots) {
  if (slots <= 2) return "Final";
  if (slots <= 4) return "Semifinals";
  if (slots <= 8) return "Quarterfinals";
  return `Round of ${slots}`;
}

export function findMatch(rounds, matchId) {
  for (const round of rounds || []) {
    const match = (round.matches || []).find((m) => m.id === matchId);
    if (match) return match;
  }
  return null;
}

function blankId(value) {
  return value ? value : null;
}

export function settleBracket(rounds) {
  const list = (rounds || []).flatMap((round) => round.matches || []);
  let guard = 0;
  let changed = true;
  while (changed && guard < 32) {
    changed = false;
    guard += 1;
    for (const match of list) {
      if (match.status === "complete") continue;
      const feedA = list.find((m) => m.nextMatchId === match.id && m.nextSlot === "A") || null;
      const feedB = list.find((m) => m.nextMatchId === match.id && m.nextSlot === "B") || null;
      const resolved = (feed) => {
        if (!feed) return { done: true };
        if (feed.status === "pending") return { done: false, teamId: null };
        if (feed.status === "empty") return { done: true, teamId: null };
        if (feed.status === "bye" || feed.status === "complete") return { done: true, teamId: blankId(feed.winnerTeamId) };
        return { done: false, teamId: null };
      };
      const apply = (slot, feed) => {
        const key = slot === "A" ? "teamAId" : "teamBId";
        const side = resolved(feed);
        const nextId = !feed ? blankId(match[key]) : side.done ? blankId(side.teamId) : null;
        if (match[key] !== nextId) {
          match[key] = nextId;
          changed = true;
        }
        return side;
      };
      const a = apply("A", feedA);
      const b = apply("B", feedB);
      const teamA = blankId(match.teamAId);
      const teamB = blankId(match.teamBId);
      const waiting = (feedA && !a.done) || (feedB && !b.done);
      let status = "pending";
      let winner = null;
      if (!waiting && teamA && teamB) {
        status = "pending";
        winner = null;
      } else if (!waiting && (teamA || teamB)) {
        status = "bye";
        winner = teamA || teamB;
      } else if (!waiting) {
        status = "empty";
        winner = null;
      }
      if (match.status !== status) {
        match.status = status;
        changed = true;
      }
      if (blankId(match.winnerTeamId) !== winner) {
        match.winnerTeamId = winner;
        changed = true;
      }
    }
  }
  return rounds;
}

export function buildSingleElim(teams) {
  if (!Array.isArray(teams) || teams.length < 2) return { error: "Need at least 2 teams to generate a bracket" };
  let size = 1;
  while (size < teams.length) size *= 2;
  if (size > 256) return { error: "Too many teams for one bracket" };
  const positions = seedPositions(size);
  const slots = new Array(size).fill(null);
  teams.forEach((team, i) => {
    const slot = positions.indexOf(i + 1);
    if (slot >= 0) slots[slot] = team;
  });
  const rounds = [];
  let matchCount = size / 2;
  let roundNum = 1;
  let previous = null;
  while (matchCount >= 1) {
    const matches = [];
    for (let i = 0; i < matchCount; i++) {
      const match = {
        id: `r${roundNum}m${i + 1}`,
        teamAId: null,
        teamBId: null,
        winnerTeamId: null,
        scoreA: null,
        scoreB: null,
        status: "pending",
        nextMatchId: null,
        nextSlot: null,
      };
      if (roundNum === 1) {
        match.teamAId = slots[i * 2] ? slots[i * 2].id : null;
        match.teamBId = slots[i * 2 + 1] ? slots[i * 2 + 1].id : null;
      }
      matches.push(match);
    }
    if (previous) {
      previous.forEach((match, i) => {
        match.nextMatchId = matches[Math.floor(i / 2)].id;
        match.nextSlot = i % 2 === 0 ? "A" : "B";
      });
    }
    rounds.push({ round: roundNum, name: roundName(matchCount * 2), matches });
    previous = matches;
    matchCount /= 2;
    roundNum += 1;
  }
  settleBracket(rounds);
  return { size, rounds };
}

export function bracketHasResults(bracket) {
  return (bracket?.rounds || []).some((round) => (round.matches || []).some((match) => match.status === "complete"));
}

export function championTeamId(bracket) {
  const rounds = bracket?.rounds || [];
  const finalMatch = rounds[rounds.length - 1]?.matches?.[0];
  if (!finalMatch) return null;
  if (finalMatch.status === "complete" || finalMatch.status === "bye") return blankId(finalMatch.winnerTeamId);
  return null;
}

function downstreamHasComplete(rounds, matchId) {
  const match = findMatch(rounds, matchId);
  if (!match?.nextMatchId) return false;
  const next = findMatch(rounds, match.nextMatchId);
  if (!next) return false;
  if (next.status === "complete") return true;
  return downstreamHasComplete(rounds, next.id);
}

export function pairRandomMixed(players, rng = Math.random) {
  const high = shuffle(
    (players || []).filter((p) => avgBand(p.avg) === "high"),
    rng
  );
  const low = shuffle(
    (players || []).filter((p) => avgBand(p.avg) === "low"),
    rng
  );
  const count = Math.min(high.length, low.length);
  const pairs = [];
  for (let i = 0; i < count; i++) pairs.push([high[i], low[i]]);
  return { pairs, unpaired: [...high.slice(count), ...low.slice(count)] };
}

function playersFromEntries(db, tournament) {
  return (tournament.entries || []).map((entry) => {
    const user = findUser(db, entry.userId);
    const view = playerView(user);
    const avg = entryAvg(db, entry);
    return {
      userId: Number(entry.userId),
      name: view.name,
      avg,
      band: avgBand(avg),
      entry,
    };
  });
}

function confirmedPairs(entries, players) {
  const byId = new Map(players.map((p) => [Number(p.userId), p]));
  const seen = new Set();
  const pairs = [];
  const unpaired = [];
  for (const entry of entries || []) {
    const id = Number(entry.userId);
    if (seen.has(id)) continue;
    const partnerId = entry.confirmedPartnerUserId ? Number(entry.confirmedPartnerUserId) : null;
    const other = partnerId ? (entries || []).find((e) => Number(e.userId) === partnerId) : null;
    const mutual = other && Number(other.confirmedPartnerUserId) === id && !seen.has(partnerId);
    if (!mutual) {
      unpaired.push(byId.get(id));
      seen.add(id);
      continue;
    }
    seen.add(id);
    seen.add(partnerId);
    pairs.push([byId.get(id), byId.get(partnerId)]);
  }
  return { pairs, unpaired };
}

function teamFromPair(pair) {
  const [a, b] = pair;
  return {
    playerIds: [Number(a.userId), Number(b.userId)],
    avg: roundAvg((Number(a.avg) + Number(b.avg)) / 2),
  };
}

function optionalWhole(value, { min, max, label }) {
  if (value === undefined || value === null || String(value).trim() === "") return { value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${label} must be a whole number from ${min} to ${max}` };
  return { value: n };
}

export function readTournamentFields(body, { timeZone, format, partnerMode } = {}) {
  const title = String(body?.title || "").trim();
  if (!title) return { error: "Give the tournament a title" };
  if (title.length > TITLE_MAX) return { error: `Keep the title to ${TITLE_MAX} characters` };
  const useFormat = format || String(body?.format || "").trim();
  if (useFormat !== "singles" && useFormat !== "doubles") return { error: "Choose singles or doubles" };
  let usePartner = null;
  if (useFormat === "doubles") {
    usePartner = partnerMode || String(body?.partnerMode || "").trim();
    if (usePartner !== "random" && usePartner !== "choose") {
      return { error: "Choose random 50+ / 50- partners, or let players pick their own partners" };
    }
  }
  const startsAt = parseStartsAt(body?.startsAt, timeZone || body?.tz);
  if (!startsAt) return { error: "Enter the date and time" };
  const description = String(body?.description || "").trim();
  if (description.length > DESCRIPTION_MAX) return { error: `Keep the description to ${DESCRIPTION_MAX} characters` };
  const capacity = optionalWhole(body?.capacity, { min: 2, max: 256, label: "Player limit" });
  if (capacity.error) return capacity;
  const bestOf = optionalWhole(body?.bestOf, { min: 1, max: 35, label: "Best of" });
  if (bestOf.error) return bestOf;
  return {
    value: {
      title,
      format: useFormat,
      partnerMode: usePartner,
      startsAt,
      description,
      capacity: capacity.value,
      bestOf: bestOf.value,
    },
  };
}

function entryOf(tournament, userId) {
  return (tournament.entries || []).find((entry) => Number(entry.userId) === Number(userId)) || null;
}

function clearLinksTo(tournament, userId) {
  const id = Number(userId);
  for (const entry of tournament.entries || []) {
    if (Number(entry.confirmedPartnerUserId) === id) entry.confirmedPartnerUserId = null;
    if (Number(entry.partnerRequestUserId) === id) entry.partnerRequestUserId = null;
  }
}

function confirmPair(tournament, aId, bId) {
  const a = entryOf(tournament, aId);
  const b = entryOf(tournament, bId);
  if (!a || !b) return fail(400, "Both players need to be signed up");
  for (const entry of tournament.entries) {
    if (Number(entry.userId) !== Number(aId) && Number(entry.partnerRequestUserId) === Number(aId)) entry.partnerRequestUserId = null;
    if (Number(entry.userId) !== Number(bId) && Number(entry.partnerRequestUserId) === Number(bId)) entry.partnerRequestUserId = null;
  }
  a.confirmedPartnerUserId = Number(bId);
  b.confirmedPartnerUserId = Number(aId);
  a.partnerRequestUserId = null;
  b.partnerRequestUserId = null;
  return { tournament };
}

function doublesChooseOpen(tournament) {
  if (tournament.format !== "doubles" || tournament.partnerMode !== "choose") {
    return fail(400, "Partners are drawn at random for this tournament");
  }
  if (tournament.status !== "open") return fail(400, "Signup is closed, so partners are locked");
  return null;
}

export function createTournament(db, user, body) {
  const parsed = readTournamentFields(body, { timeZone: body?.tz });
  if (parsed.error) return fail(400, parsed.error);
  const list = ensureList(db);
  const tournament = {
    id: nextId(list),
    ...parsed.value,
    status: "open",
    createdById: user?.id ?? null,
    createdAt: new Date().toISOString(),
    entries: [],
    teams: [],
    bracket: null,
    generatedAt: null,
  };
  list.unshift(tournament);
  return { status: 200, tournament };
}

export function updateTournament(db, id, body) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  if (body?.format && String(body.format) !== tournament.format) {
    return fail(400, "Format cannot be changed after the tournament is posted");
  }
  if (tournament.format === "doubles" && body?.partnerMode && String(body.partnerMode) !== tournament.partnerMode) {
    return fail(400, "Partner setup cannot be changed after the tournament is posted");
  }
  const parsed = readTournamentFields(
    { ...tournament, ...body, format: tournament.format, partnerMode: tournament.partnerMode },
    { timeZone: body?.tz, format: tournament.format, partnerMode: tournament.partnerMode }
  );
  if (parsed.error) return fail(400, parsed.error);
  if (tournament.status !== "open" && parsed.value.capacity !== (tournament.capacity ?? null)) {
    return fail(400, "The player limit can only change while signup is open");
  }
  if (parsed.value.capacity != null && parsed.value.capacity < (tournament.entries || []).length) {
    return fail(400, "The player limit cannot be lower than the number already signed up");
  }
  tournament.title = parsed.value.title;
  tournament.description = parsed.value.description;
  tournament.startsAt = parsed.value.startsAt;
  tournament.bestOf = parsed.value.bestOf;
  if (tournament.status === "open") tournament.capacity = parsed.value.capacity;
  return { status: 200, tournament };
}

export function deleteTournament(db, id) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  db.tournaments = ensureList(db).filter((item) => Number(item.id) !== Number(tournament.id));
  return { status: 200, tournament, removed: true };
}

export function signupTournament(db, id, user) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  if (!user) return fail(401, "Login required");
  if (tournament.status !== "open") return fail(400, "Signup is closed");
  if (entryOf(tournament, user.id)) return fail(400, "You are already signed up");
  if (tournament.capacity != null && (tournament.entries || []).length >= tournament.capacity) {
    return fail(400, "This tournament is full");
  }
  tournament.entries.push({
    userId: Number(user.id),
    signedUpAt: new Date().toISOString(),
    avg: roundAvg(user.avg),
    partnerRequestUserId: null,
    confirmedPartnerUserId: null,
  });
  return { status: 200, tournament };
}

export function withdrawTournament(db, id, user) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  if (!user) return fail(401, "Login required");
  if (tournament.status !== "open") return fail(400, "Signup is closed");
  if (!entryOf(tournament, user.id)) return fail(400, "You are not signed up");
  clearLinksTo(tournament, user.id);
  tournament.entries = tournament.entries.filter((entry) => Number(entry.userId) !== Number(user.id));
  return { status: 200, tournament };
}

export function requestPartner(db, id, user, partnerUserId) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  const blocked = doublesChooseOpen(tournament);
  if (blocked) return blocked;
  const me = entryOf(tournament, user?.id);
  if (!me) return fail(400, "Sign up before choosing a partner");
  const partnerId = Number(partnerUserId);
  if (!partnerId || partnerId === Number(user.id)) return fail(400, "Choose another player");
  const them = entryOf(tournament, partnerId);
  if (!them) return fail(400, "That player is not signed up yet");
  if (me.confirmedPartnerUserId) return fail(400, "Clear your current partner first");
  if (them.confirmedPartnerUserId) return fail(400, "That player already has a partner");
  if (Number(them.partnerRequestUserId) === Number(user.id)) return confirmPair(tournament, user.id, partnerId);
  me.partnerRequestUserId = partnerId;
  return { status: 200, tournament };
}

export function acceptPartner(db, id, user, partnerUserId) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  const blocked = doublesChooseOpen(tournament);
  if (blocked) return blocked;
  const me = entryOf(tournament, user?.id);
  if (!me) return fail(400, "Sign up before accepting a partner");
  const partnerId = Number(partnerUserId);
  const them = entryOf(tournament, partnerId);
  if (!them || Number(them.partnerRequestUserId) !== Number(user.id)) {
    return fail(400, "That player has not asked you to partner");
  }
  if (me.confirmedPartnerUserId || them.confirmedPartnerUserId) return fail(400, "One of you already has a partner");
  return confirmPair(tournament, user.id, partnerId);
}

export function declinePartner(db, id, user, partnerUserId) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  const blocked = doublesChooseOpen(tournament);
  if (blocked) return blocked;
  const them = entryOf(tournament, partnerUserId);
  if (!them || Number(them.partnerRequestUserId) !== Number(user?.id)) {
    return fail(400, "There is no partner request from that player");
  }
  them.partnerRequestUserId = null;
  return { status: 200, tournament };
}

export function clearPartner(db, id, user) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  const blocked = doublesChooseOpen(tournament);
  if (blocked) return blocked;
  const me = entryOf(tournament, user?.id);
  if (!me) return fail(400, "You are not signed up");
  if (!me.confirmedPartnerUserId && !me.partnerRequestUserId) return fail(400, "You do not have a partner to clear");
  if (me.confirmedPartnerUserId) {
    const partner = entryOf(tournament, me.confirmedPartnerUserId);
    if (partner && Number(partner.confirmedPartnerUserId) === Number(user.id)) partner.confirmedPartnerUserId = null;
    me.confirmedPartnerUserId = null;
  }
  me.partnerRequestUserId = null;
  return { status: 200, tournament };
}

export function generateTournamentBracket(db, id, { replace = false, rng = Math.random } = {}) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  if (tournament.status === "complete") return fail(400, "This tournament is finished");
  if (tournament.bracket && !replace) return fail(400, "Brackets are already generated");
  if (tournament.bracket && bracketHasResults(tournament.bracket)) {
    return fail(400, "A match already has a result, so the bracket cannot be regenerated");
  }
  const players = playersFromEntries(db, tournament);
  let units = [];
  let unpaired = [];
  if (tournament.format === "singles") {
    if (players.length < 2) return fail(400, "Need at least 2 players to generate a bracket");
    units = players.map((player) => ({ playerIds: [player.userId], avg: roundAvg(player.avg) }));
  } else if (tournament.partnerMode === "random") {
    const drawn = pairRandomMixed(players, rng);
    unpaired = drawn.unpaired;
    if (!drawn.pairs.length) {
      return fail(400, "Need at least one 50+ player and one player under 50. Averages of 50.00 and above are 50+.");
    }
    if (drawn.pairs.length < 2) {
      return fail(400, "Need at least two mixed pairs. Each pair is one 50+ player and one player under 50.");
    }
    units = drawn.pairs.map(teamFromPair);
  } else {
    const drawn = confirmedPairs(tournament.entries, players);
    unpaired = drawn.unpaired;
    if (drawn.pairs.length < 2) {
      return fail(400, "Need at least two confirmed pairs. Players sign up and accept a partner first.");
    }
    units = drawn.pairs.map(teamFromPair);
  }
  units.sort((a, b) => b.avg - a.avg || a.playerIds[0] - b.playerIds[0]);
  const teams = units.map((unit, index) => ({
    id: `t${index + 1}`,
    seed: index + 1,
    playerIds: unit.playerIds,
    avg: unit.avg,
  }));
  const built = buildSingleElim(teams);
  if (built.error) return fail(400, built.error);
  tournament.teams = teams;
  tournament.bracket = built;
  tournament.generatedAt = new Date().toISOString();
  tournament.status = championTeamId(built) ? "complete" : "brackets";
  return { status: 200, tournament, unpairedCount: unpaired.length };
}

function parseScores(body, winnerTeamId, match) {
  const blank = (value) => value === undefined || value === null || String(value).trim() === "";
  if (blank(body?.scoreA) && blank(body?.scoreB)) return { scoreA: null, scoreB: null };
  if (blank(body?.scoreA) || blank(body?.scoreB)) return { error: "Enter both scores, or leave both blank" };
  const scoreA = Number(body.scoreA);
  const scoreB = Number(body.scoreB);
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 99 || scoreB > 99) {
    return { error: "Scores must be whole numbers from 0 to 99" };
  }
  const winnerScore = winnerTeamId === match.teamAId ? scoreA : scoreB;
  const loserScore = winnerTeamId === match.teamAId ? scoreB : scoreA;
  if (winnerScore <= loserScore) return { error: "The winner needs the higher score" };
  return { scoreA, scoreB };
}

export function recordTournamentResult(db, id, matchId, body) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  if (!tournament.bracket) return fail(400, "Generate the bracket first");
  const match = findMatch(tournament.bracket.rounds, String(matchId || ""));
  if (!match) return fail(404, "Match not found");
  if (match.status === "bye") return fail(400, "That match is a bye");
  if (match.status === "empty") return fail(400, "That match has no players");
  if (!match.teamAId || !match.teamBId) return fail(400, "Both sides are not in yet");
  const winnerTeamId = String(body?.winnerTeamId || "");
  if (winnerTeamId !== match.teamAId && winnerTeamId !== match.teamBId) {
    return fail(400, "Winner must be one of the two sides");
  }
  const scores = parseScores(body, winnerTeamId, match);
  if (scores.error) return fail(400, scores.error);
  if (downstreamHasComplete(tournament.bracket.rounds, match.id)) {
    return fail(400, "A later match already has a result");
  }
  match.status = "complete";
  match.winnerTeamId = winnerTeamId;
  match.scoreA = scores.scoreA;
  match.scoreB = scores.scoreB;
  settleBracket(tournament.bracket.rounds);
  tournament.status = championTeamId(tournament.bracket) ? "complete" : "brackets";
  return { status: 200, tournament };
}

function teamName(db, team) {
  return (team?.playerIds || [])
    .map((id) => playerView(findUser(db, id)).name)
    .filter(Boolean)
    .join(" & ");
}

function presentTeam(db, tournament, team) {
  if (!team) return null;
  const players = (team.playerIds || []).map((id) => {
    const entry = (tournament.entries || []).find((item) => Number(item.userId) === Number(id));
    if (!entry) return playerView(findUser(db, id));
    const view = entrantView(db, entry);
    return { userId: view.userId, name: view.name, avg: view.avg, band: view.band, bandLabel: view.bandLabel };
  });
  return {
    id: team.id,
    seed: team.seed || null,
    name: players.map((player) => player.name).filter(Boolean).join(" & ") || teamName(db, team) || "Team",
    avg: roundAvg(team.avg),
    playerIds: (team.playerIds || []).map(Number),
    players,
  };
}

function championName(db, tournament) {
  const id = championTeamId(tournament.bracket);
  if (!id) return "";
  const team = (tournament.teams || []).find((item) => item.id === id);
  return team ? teamName(db, team) : "";
}

function statusRank(status) {
  if (status === "open") return 0;
  if (status === "brackets") return 1;
  if (status === "complete") return 2;
  return 9;
}

export function publicTournament(db, tournament, viewer, { detail = false, canManage = false } = {}) {
  const entries = Array.isArray(tournament.entries) ? tournament.entries : [];
  const meId = viewer ? Number(viewer.id) : null;
  const mine = meId ? entries.find((entry) => Number(entry.userId) === meId) || null : null;
  const postedBy = findUser(db, tournament.createdById);
  const base = {
    id: tournament.id,
    title: tournament.title,
    format: tournament.format,
    partnerMode: tournament.partnerMode || null,
    status: tournament.status,
    startsAt: tournament.startsAt,
    description: tournament.description || "",
    capacity: tournament.capacity ?? null,
    bestOf: tournament.bestOf ?? null,
    createdAt: tournament.createdAt || null,
    generatedAt: tournament.generatedAt || null,
    postedByName: postedBy ? playerView(postedBy).name : "Staff",
    entryCount: entries.length,
    canManage: Boolean(canManage),
    joined: Boolean(mine),
    championName: championName(db, tournament),
    viewer: viewer ? playerView(viewer) : null,
  };
  if (!detail) return base;

  const entryViews = entries.map((entry) => entrantView(db, entry));
  const teams = (tournament.teams || []).map((team) => presentTeam(db, tournament, team));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const teamed = new Set(teams.flatMap((team) => team.playerIds));
  const incoming = mine
    ? entries
        .filter((entry) => Number(entry.partnerRequestUserId) === meId)
        .map((entry) => entrantView(db, entry))
    : [];
  const meView = mine ? entryViews.find((entry) => Number(entry.userId) === meId) || null : null;
  const partnerChoices =
    viewer && tournament.format === "doubles" && tournament.partnerMode === "choose" && tournament.status === "open" && mine && !mine.confirmedPartnerUserId
      ? entryViews.filter((entry) => Number(entry.userId) !== meId && !entry.confirmedPartnerUserId)
      : [];
  const bracket = tournament.bracket
    ? {
        size: tournament.bracket.size,
        rounds: (tournament.bracket.rounds || []).map((round) => ({
          round: round.round,
          name: round.name,
          matches: (round.matches || []).map((match) => ({
            id: match.id,
            status: match.status,
            teamAId: match.teamAId || null,
            teamBId: match.teamBId || null,
            teamA: match.teamAId ? teamById.get(match.teamAId) || null : null,
            teamB: match.teamBId ? teamById.get(match.teamBId) || null : null,
            winnerTeamId: match.winnerTeamId || null,
            scoreA: match.scoreA ?? null,
            scoreB: match.scoreB ?? null,
            nextMatchId: match.nextMatchId || null,
            nextSlot: match.nextSlot || null,
          })),
        })),
      }
    : null;
  const high = entryViews.filter((entry) => entry.band === "high").length;
  return {
    ...base,
    entries: entryViews,
    teams,
    bracket,
    unpaired: tournament.bracket ? entryViews.filter((entry) => !teamed.has(Number(entry.userId))) : [],
    bandCounts: { high, low: entryViews.length - high },
    partnerChoices,
    me: meView ? { ...meView, incoming } : null,
  };
}

export function listTournaments(db, viewer, canManage) {
  return ensureList(db)
    .map((tournament) => publicTournament(db, tournament, viewer, { detail: false, canManage }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || String(a.startsAt).localeCompare(String(b.startsAt)) || b.id - a.id);
}
