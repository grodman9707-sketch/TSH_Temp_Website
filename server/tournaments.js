// Scheduled tournaments: signup, doubles pairing, and single-elimination brackets.
// A random doubles draw pairs one player at or above the cutoff with one below it.
// The cutoff defaults to 50. Even teams pair the highest average with the lowest.
// Signup can also be split into separate brackets by that cutoff or by division.

import { wheelStepMs } from "../public/tournamentWheel.js";
import { isValidTimeZone, wallStringToUtc } from "./timezones.js";

export const AVG_SPLIT = 50;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 2000;

export function avgBand(avg, split = AVG_SPLIT) {
  const n = Number(avg);
  const line = Number(split);
  const cutoff = Number.isFinite(line) ? line : AVG_SPLIT;
  if (!Number.isFinite(n)) return "low";
  return n >= cutoff ? "high" : "low";
}

export function splitText(split) {
  const n = Number(split);
  const value = Number.isFinite(n) ? Math.round(n * 100) / 100 : AVG_SPLIT;
  return Number.isInteger(value) ? String(value) : String(value);
}

export function bandLabel(band, split = AVG_SPLIT) {
  const text = splitText(split);
  return band === "high" ? `${text}+` : `${text}-`;
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

// Bracket slots use the account name (the name entered at signup).
// Nickname stays on the signup list and the draw wheel. A blank account
// name falls back to the nickname so a slot is never empty.
export function bracketPlayerName(user) {
  const legal = String(user?.name || "").trim();
  const nick = String(user?.nickname || "").trim();
  if (legal) return legal.slice(0, 80);
  if (nick) return nick.slice(0, 80);
  return user ? "Player" : "Removed player";
}

function entryAvg(db, entry) {
  if (entry && entry.avg != null && entry.avg !== "") return roundAvg(entry.avg);
  return playerView(findUser(db, entry?.userId)).avg;
}

function entrantView(db, entry, tournament) {
  const user = findUser(db, entry.userId);
  const base = playerView(user);
  const avg = entryAvg(db, entry);
  const split = tournament ? cutoffOf(tournament) : AVG_SPLIT;
  const band = avgBand(avg, split);
  const leagueIds = Array.isArray(entry.leagueIds) ? [...new Set(entry.leagueIds.map(Number).filter(Boolean))] : userLeagueIds(user);
  let poolId = entry.poolId;
  if ((poolId == null || poolId === "") && tournament) poolId = poolIdFor(tournament, { avg, leagueIds });
  if (!poolId) poolId = !tournament || (tournament.poolMode || "none") === "none" ? "all" : "";
  const partnerId = entry.confirmedPartnerUserId ? Number(entry.confirmedPartnerUserId) : null;
  const requestId = entry.partnerRequestUserId ? Number(entry.partnerRequestUserId) : null;
  const partner = partnerId ? playerView(findUser(db, partnerId)) : null;
  const requested = requestId ? playerView(findUser(db, requestId)) : null;
  return {
    ...base,
    avg,
    band,
    bandLabel: bandLabel(band, split),
    leagueIds,
    divisionLabel: joinNames(leagueIds.map((id) => divisionName(findLeague(db, id)))),
    poolId,
    poolName: tournament ? poolNameOf(tournament, poolId) : "",
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

export function buildSingleElim(teams, options = {}) {
  const idPrefix = String(options.idPrefix || "");
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
        id: `${idPrefix}r${roundNum}m${i + 1}`,
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

export function pairRandomMixed(players, rng = Math.random, split = AVG_SPLIT) {
  const high = shuffle(
    (players || []).filter((p) => avgBand(p.avg, split) === "high"),
    rng
  );
  const low = shuffle(
    (players || []).filter((p) => avgBand(p.avg, split) === "low"),
    rng
  );
  const count = Math.min(high.length, low.length);
  const pairs = [];
  for (let i = 0; i < count; i++) pairs.push([high[i], low[i]]);
  return { pairs, unpaired: [...high.slice(count), ...low.slice(count)] };
}

// Pair the highest average with the lowest so the team totals stay as close as possible.
// An odd field leaves out the middle average. That player is the closest to the rest.
export function pairEven(players) {
  const sorted = (players || [])
    .slice()
    .sort((a, b) => Number(b.avg) - Number(a.avg) || Number(a.userId) - Number(b.userId));
  if (sorted.length < 2) return { pairs: [], unpaired: sorted };
  const working = sorted.slice();
  let unpaired = [];
  if (working.length % 2 === 1) {
    const mid = Math.floor(working.length / 2);
    unpaired = working.splice(mid, 1);
  }
  const pairs = [];
  const half = working.length / 2;
  for (let i = 0; i < half; i++) pairs.push([working[i], working[working.length - 1 - i]]);
  return { pairs, unpaired };
}

function userLeagueIds(user) {
  if (Array.isArray(user?.leagueIds)) return [...new Set(user.leagueIds.map(Number).filter(Boolean))];
  if (user?.leagueId) return [Number(user.leagueId)];
  return [];
}

function divisionName(league) {
  const raw = String(league?.name || "").trim();
  const named = raw.match(/^League\s+(\d+)$/i);
  return named ? `Division ${named[1]}` : raw || "Division";
}

function findLeague(db, id) {
  return (db.leagues || []).find((league) => Number(league.id) === Number(id)) || null;
}

function joinNames(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function knownLeagueIds(db) {
  return new Set((db.leagues || []).map((league) => Number(league.id)));
}

function sortLeagueIds(db, ids) {
  const order = new Map((db.leagues || []).map((league) => [Number(league.id), Number(league.sortOrder) || 0]));
  return ids.slice().sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0) || a - b);
}

function readIdList(value) {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed.split(",");
      }
    } else raw = trimmed.split(",");
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function cutoffOf(tournament) {
  const n = Number(tournament?.avgSplit);
  return Number.isFinite(n) ? n : AVG_SPLIT;
}

function poolDefs(tournament) {
  const mode = tournament?.poolMode || "none";
  if (mode === "avg") {
    const split = cutoffOf(tournament);
    return [
      { id: "high", name: bandLabel("high", split) },
      { id: "low", name: bandLabel("low", split) },
    ];
  }
  if (mode === "division") return (tournament.pools || []).map((pool) => ({ id: pool.id, name: pool.name }));
  return [{ id: "all", name: "Field" }];
}

function poolIdFor(tournament, { avg, leagueIds }) {
  const mode = tournament?.poolMode || "none";
  if (mode === "avg") return avgBand(avg, cutoffOf(tournament)) === "high" ? "high" : "low";
  if (mode === "division") {
    const mine = new Set((leagueIds || []).map(Number));
    const pool = (tournament.pools || []).find((item) => (item.leagueIds || []).some((id) => mine.has(Number(id))));
    return pool ? pool.id : "";
  }
  return "all";
}

function poolNameOf(tournament, poolId) {
  return poolDefs(tournament).find((pool) => pool.id === poolId)?.name || "";
}

function playersFromEntries(db, tournament) {
  const split = cutoffOf(tournament);
  return (tournament.entries || []).map((entry) => {
    const user = findUser(db, entry.userId);
    const view = playerView(user);
    const avg = entryAvg(db, entry);
    const leagueIds = Array.isArray(entry.leagueIds) ? [...new Set(entry.leagueIds.map(Number).filter(Boolean))] : userLeagueIds(user);
    let poolId = entry.poolId;
    if (poolId == null || poolId === "") poolId = poolIdFor(tournament, { avg, leagueIds });
    if (!poolId) poolId = (tournament.poolMode || "none") === "none" ? "all" : "";
    return {
      userId: Number(entry.userId),
      name: view.name,
      avg,
      band: avgBand(avg, split),
      leagueIds,
      poolId,
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
    if (usePartner !== "random" && usePartner !== "choose" && usePartner !== "even") {
      return { error: "Choose even teams, random mixed partners, or let players pick their own partners" };
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
    return fail(400, "Partners are assigned when the bracket is generated for this tournament");
  }
  if (tournament.status !== "open") return fail(400, "Signup is closed, so partners are locked");
  return null;
}

function readAvgSplit(body) {
  if (body?.avgSplit === undefined || body?.avgSplit === null || String(body.avgSplit).trim() === "") return { value: AVG_SPLIT };
  const n = Number(body.avgSplit);
  if (!Number.isFinite(n) || n < 0 || n > 200) return { error: "Average cutoff must be a number from 0 to 200" };
  return { value: Math.round(n * 100) / 100 };
}

function resolveScope(db, body, access) {
  const requested = sortLeagueIds(db, readIdList(body?.leagueIds ?? body?.leagueId));
  const known = knownLeagueIds(db);
  if (requested.some((id) => !known.has(id))) return { error: "Choose a division that exists" };
  if (access?.override === false) {
    const allowed = sortLeagueIds(db, (access.leagueIds || []).map(Number).filter((id) => known.has(id)));
    const ids = requested.length ? requested : allowed;
    if (!ids.length) return { error: "You need a division assigned before you can post a tournament" };
    if (ids.some((id) => !allowed.includes(id))) return { error: "You can only post a tournament for your own division" };
    return { leagueIds: ids };
  }
  return { leagueIds: requested };
}

function resolvePools(db, body, fields, leagueIds) {
  const poolMode = String(body?.poolMode || "none").trim() || "none";
  if (!["none", "avg", "division"].includes(poolMode)) return { error: "Choose one field, an average split, or division pools" };
  const split = readAvgSplit(body);
  if (split.error) return split;
  if (poolMode === "avg" && fields.partnerMode === "random") {
    return { error: "Average pools each get their own bracket. Use even teams, or let players choose partners." };
  }
  if (poolMode !== "division") return { poolMode, avgSplit: split.value, pools: [] };
  let raw = body?.pools;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { error: "Pool setup could not be read" };
    }
  }
  if (!Array.isArray(raw) || raw.length < 2) return { error: "Add at least two division pools" };
  if (raw.length > 8) return { error: "Keep it to 8 pools" };
  const known = knownLeagueIds(db);
  const used = new Set();
  const pools = [];
  for (const item of raw) {
    const name = String(item?.name || "").trim();
    if (!name) return { error: "Each pool needs a name" };
    if (name.length > 60) return { error: "Keep each pool name to 60 characters" };
    const ids = sortLeagueIds(db, readIdList(item?.leagueIds));
    if (!ids.length) return { error: `${name} needs at least one division` };
    for (const id of ids) {
      if (!known.has(id)) return { error: "Choose a division that exists" };
      if (leagueIds.length && !leagueIds.includes(id)) return { error: "Pools can only include divisions that are playing in this tournament" };
      if (used.has(id)) return { error: "A division can only be in one pool" };
      used.add(id);
    }
    pools.push({ id: `p${pools.length + 1}`, name, leagueIds: ids });
  }
  if (leagueIds.length && leagueIds.some((id) => !used.has(id))) return { error: "Put every selected division into a pool" };
  return { poolMode, avgSplit: split.value, pools };
}

function audiencePhrase(db, tournament) {
  const ids = (tournament.leagueIds || []).map(Number);
  if (!ids.length) return "all players";
  return joinNames(ids.map((id) => divisionName(findLeague(db, id))));
}

export function createTournament(db, user, body, access = { override: true }) {
  const parsed = readTournamentFields(body, { timeZone: body?.tz });
  if (parsed.error) return fail(400, parsed.error);
  const scope = resolveScope(db, body, access);
  if (scope.error) return fail(400, scope.error);
  const setup = resolvePools(db, body, parsed.value, scope.leagueIds);
  if (setup.error) return fail(400, setup.error);
  const list = ensureList(db);
  const tournament = {
    id: nextId(list),
    ...parsed.value,
    leagueIds: scope.leagueIds,
    poolMode: setup.poolMode,
    avgSplit: setup.avgSplit,
    pools: setup.pools,
    manualTeams: [],
    wheelReveal: null,
    status: "open",
    createdById: user?.id ?? null,
    createdAt: new Date().toISOString(),
    entries: [],
    teams: [],
    bracket: null,
    draws: null,
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
  if (body?.poolMode != null && String(body.poolMode) !== (tournament.poolMode || "none")) {
    return fail(400, "Pools cannot be changed after the tournament is posted");
  }
  if (body?.avgSplit != null && String(body.avgSplit).trim() !== "" && Number(body.avgSplit) !== Number(tournament.avgSplit ?? AVG_SPLIT)) {
    return fail(400, "The average cutoff cannot be changed after the tournament is posted");
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
  const leagueIds = userLeagueIds(user);
  const limits = (tournament.leagueIds || []).map(Number);
  if (limits.length && !leagueIds.some((id) => limits.includes(id))) {
    return fail(400, `This tournament is only for ${audiencePhrase(db, tournament)}`);
  }
  const avg = roundAvg(user.avg);
  const poolId = poolIdFor(tournament, { avg, leagueIds });
  if ((tournament.poolMode || "none") === "division" && !poolId) {
    return fail(400, "Your division is not in a pool for this tournament");
  }
  tournament.entries.push({
    userId: Number(user.id),
    signedUpAt: new Date().toISOString(),
    avg,
    leagueIds,
    poolId: poolId || "all",
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
  const leaving = Number(user.id);
  tournament.manualTeams = (tournament.manualTeams || [])
    .map((team) => ({ ...team, playerIds: (team.playerIds || []).map(Number).filter((id) => id !== leaving) }))
    .filter((team) => team.playerIds.length);
  scrubWheelReveal(tournament, leaving);
  tournament.entries = tournament.entries.filter((entry) => Number(entry.userId) !== leaving);
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
  if ((tournament.poolMode || "none") !== "none") {
    const records = playersFromEntries(db, tournament);
    const mine = records.find((player) => player.userId === Number(user.id));
    const theirs = records.find((player) => player.userId === partnerId);
    if (!mine?.poolId || mine.poolId !== theirs?.poolId) return fail(400, "Choose a partner from your own pool");
  }
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

function drawList(tournament) {
  if (Array.isArray(tournament?.draws) && tournament.draws.length) return tournament.draws.filter((draw) => draw?.bracket);
  if (tournament?.bracket) return [{ poolId: "all", name: "", teams: tournament.teams || [], bracket: tournament.bracket }];
  return [];
}

function tournamentHasResults(tournament) {
  return drawList(tournament).some((draw) => bracketHasResults(draw.bracket));
}

function mixedShort(split, pairs) {
  const label = splitText(split);
  if (!pairs.length) {
    if (Number(split) === AVG_SPLIT) return "Need at least one 50+ player and one player under 50. Averages of 50.00 and above are 50+.";
    return `Need at least one ${label}+ player and one player under ${label}. An average of ${label} or higher is ${label}+.`;
  }
  if (pairs.length < 2) {
    if (Number(split) === AVG_SPLIT) return "Need at least two mixed pairs. Each pair is one 50+ player and one player under 50.";
    return `Need at least two mixed pairs. Each pair is one ${label}+ player and one player under ${label}.`;
  }
  return "";
}

function autoUnits(tournament, players, rng) {
  if (tournament.format === "singles") {
    if (players.length < 2) return { units: [], unpaired: players, short: "Need at least 2 players to generate a bracket" };
    return { units: players.map((player) => ({ playerIds: [player.userId], avg: roundAvg(player.avg) })), unpaired: [] };
  }
  if (tournament.partnerMode === "even") {
    const drawn = pairEven(players);
    if (drawn.pairs.length < 2) {
      return {
        units: [],
        unpaired: players,
        short: "Need at least four players to make two even teams. The highest average is paired with the lowest.",
      };
    }
    return { units: drawn.pairs.map(teamFromPair), unpaired: drawn.unpaired };
  }
  if (tournament.partnerMode === "random") {
    const split = cutoffOf(tournament);
    const drawn = pairRandomMixed(players, rng, split);
    const short = mixedShort(split, drawn.pairs);
    if (short) return { units: [], unpaired: players, short };
    return { units: drawn.pairs.map(teamFromPair), unpaired: drawn.unpaired };
  }
  const ids = new Set(players.map((player) => player.userId));
  const entries = (tournament.entries || []).filter((entry) => ids.has(Number(entry.userId)));
  const drawn = confirmedPairs(entries, players);
  if (drawn.pairs.length < 2) {
    return { units: [], unpaired: players, short: "Need at least two confirmed pairs. Players sign up and accept a partner first." };
  }
  return { units: drawn.pairs.map(teamFromPair), unpaired: drawn.unpaired.filter(Boolean) };
}

function manualUnits(players, manual) {
  const byId = new Map(players.map((player) => [player.userId, player]));
  const used = new Set();
  const units = [];
  for (const team of manual) {
    const ids = [];
    for (const value of team.playerIds || []) {
      const id = Number(value);
      if (!byId.has(id) || used.has(id)) continue;
      ids.push(id);
    }
    if (ids.length !== 2) continue;
    ids.forEach((id) => used.add(id));
    units.push(teamFromPair(ids.map((id) => byId.get(id))));
  }
  return { units, unpaired: players.filter((player) => !used.has(player.userId)) };
}

function unitsFor(tournament, players, rng) {
  const manual = (tournament.manualTeams || []).filter((team) => (team.playerIds || []).length);
  if (tournament.format === "doubles" && manual.length) {
    const built = manualUnits(players, manual);
    if (built.units.length < 2) {
      return {
        units: built.units,
        unpaired: built.unpaired,
        short: "Need at least two complete teams. Fill both seats, or clear the team edits and generate again.",
      };
    }
    return built;
  }
  return autoUnits(tournament, players, rng);
}

function unitsToTeams(units, poolId, pooled) {
  const sorted = units.slice().sort((a, b) => b.avg - a.avg || a.playerIds[0] - b.playerIds[0]);
  return sorted.map((unit, index) => ({
    id: pooled ? `${poolId}-t${index + 1}` : `t${index + 1}`,
    seed: index + 1,
    playerIds: unit.playerIds,
    avg: unit.avg,
    poolId: pooled ? poolId : "all",
  }));
}

function composeBracket(db, tournament, rng) {
  const players = playersFromEntries(db, tournament);
  const pooled = (tournament.poolMode || "none") !== "none";
  if (!pooled) {
    const built = unitsFor(tournament, players, rng);
    if (built.short) return { error: built.short };
    const teams = unitsToTeams(built.units, "all", false);
    const bracket = buildSingleElim(teams);
    if (bracket.error) return { error: bracket.error };
    return { teams, bracket, draws: null, unpaired: built.unpaired.filter(Boolean) };
  }
  const draws = [];
  const unpaired = [];
  const problems = [];
  const defs = poolDefs(tournament);
  for (const pool of defs) {
    const group = players.filter((player) => player.poolId === pool.id);
    const built = unitsFor(tournament, group, rng);
    if (built.short || built.units.length < 2) {
      problems.push(built.short || `${pool.name} does not have enough players for a bracket`);
      unpaired.push(...group);
      continue;
    }
    const teams = unitsToTeams(built.units, pool.id, true);
    const bracket = buildSingleElim(teams, { idPrefix: `${pool.id}-` });
    if (bracket.error) return { error: bracket.error };
    draws.push({ poolId: pool.id, name: pool.name, teams, bracket });
    unpaired.push(...built.unpaired.filter(Boolean));
  }
  for (const player of players) {
    if (!defs.some((pool) => pool.id === player.poolId)) unpaired.push(player);
  }
  if (!draws.length) return { error: problems[0] || "Need at least one pool with enough players for a bracket" };
  return { teams: draws.flatMap((draw) => draw.teams), bracket: null, draws, unpaired };
}

function refreshStatus(tournament) {
  const draws = drawList(tournament);
  tournament.status = draws.length && draws.every((draw) => championTeamId(draw.bracket)) ? "complete" : "brackets";
}

function applyBracket(tournament, composed) {
  tournament.teams = composed.teams;
  tournament.bracket = composed.bracket || null;
  tournament.draws = composed.draws || null;
  tournament.generatedAt = new Date().toISOString();
  refreshStatus(tournament);
}

export function generateTournamentBracket(db, id, { replace = false, rng = Math.random } = {}) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  if (tournament.status === "complete") return fail(400, "This tournament is finished");
  const existing = drawList(tournament);
  if (existing.length && !replace) return fail(400, "Brackets are already generated");
  if (existing.length && tournamentHasResults(tournament)) {
    return fail(400, "A match already has a result, so the bracket cannot be regenerated");
  }
  const previousManual = tournament.manualTeams;
  if (replace) tournament.manualTeams = [];
  const composed = composeBracket(db, tournament, rng);
  if (composed.error) {
    tournament.manualTeams = previousManual;
    return fail(400, composed.error);
  }
  applyBracket(tournament, composed);
  return { status: 200, tournament, unpairedCount: composed.unpaired.length };
}

function parseManualTeams(db, tournament, cards) {
  if (!Array.isArray(cards)) return { error: "Add the teams to save" };
  if (cards.length > 128) return { error: "Too many teams" };
  const players = playersFromEntries(db, tournament);
  const byId = new Map(players.map((player) => [player.userId, player]));
  const seen = new Set();
  const teams = [];
  for (const card of cards) {
    const raw = Array.isArray(card?.playerIds) ? card.playerIds : [];
    const ids = [];
    for (const value of raw) {
      if (value == null || value === "") continue;
      const id = Number(value);
      if (!byId.has(id)) return { error: "Every seat has to be a signed-up player" };
      if (seen.has(id)) return { error: "A player can only be on one team" };
      seen.add(id);
      ids.push(id);
    }
    if (!ids.length) continue;
    if (ids.length > 2) return { error: "A doubles team has two players" };
    const pools = new Set(ids.map((id) => byId.get(id).poolId));
    if (pools.size > 1) return { error: "Partners have to be in the same pool" };
    const poolId = [...pools][0] || "";
    if ((tournament.poolMode || "none") !== "none" && !poolId) return { error: "That player is not in a pool" };
    teams.push({ playerIds: ids, poolId: poolId || "all" });
  }
  return { teams };
}

export function saveTournamentTeams(db, id, body) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  if (tournament.format !== "doubles") return fail(400, "Teams can be edited in doubles");
  if (tournament.status === "complete") return fail(400, "This tournament is finished");
  if (tournamentHasResults(tournament)) return fail(400, "A match already has a result, so the teams cannot be changed");
  const parsed = parseManualTeams(db, tournament, body?.teams);
  if (parsed.error) return fail(400, parsed.error);
  const previousManual = tournament.manualTeams;
  const previousReveal = tournament.wheelReveal || null;
  tournament.manualTeams = parsed.teams;
  tournament.wheelReveal = null;
  if (!drawList(tournament).length) return { status: 200, tournament };
  const composed = composeBracket(db, tournament, Math.random);
  if (composed.error) {
    tournament.manualTeams = previousManual;
    tournament.wheelReveal = previousReveal;
    return fail(400, composed.error);
  }
  applyBracket(tournament, composed);
  return { status: 200, tournament, unpairedCount: composed.unpaired.length };
}

function scrubWheelReveal(tournament, userId) {
  const reveal = tournament.wheelReveal;
  if (!reveal) return;
  const id = Number(userId);
  if ((reveal.order || []).map(Number).includes(id)) {
    tournament.wheelReveal = null;
    return;
  }
  reveal.satOut = (reveal.satOut || []).filter((person) => Number(person.userId) !== id);
  reveal.players = (reveal.players || []).filter((person) => Number(person.userId) !== id);
}

function buildWheelReveal(db, tournament, rng) {
  const players = playersFromEntries(db, tournament);
  const byId = new Map(players.map((player) => [Number(player.userId), player]));
  const pairs = [];
  const used = new Set();
  for (const team of tournament.manualTeams || []) {
    const seats = (team.playerIds || []).map((id) => byId.get(Number(id))).filter(Boolean);
    if (seats.length !== 2) continue;
    seats.forEach((player) => used.add(player.userId));
    pairs.push(seats);
  }
  const ordered = shuffle(pairs, rng).map((pair) => shuffle(pair.slice(), rng));
  const wheelPlayers = players
    .map((player) => ({ userId: Number(player.userId), name: player.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId - b.userId);
  return {
    id: `${Date.now().toString(36)}-${Math.floor(rng() * 1e9).toString(36)}`,
    startedAt: new Date().toISOString(),
    stepMs: wheelStepMs(ordered.length * 2),
    order: ordered.flat().map((player) => Number(player.userId)),
    pairs: ordered.map((pair) => pair.map((player) => Number(player.userId))),
    satOut: players.filter((player) => !used.has(player.userId)).map((player) => ({ userId: Number(player.userId), name: player.name })),
    players: wheelPlayers,
  };
}

export function balanceTournamentTeams(db, id, options = {}) {
  const rng = typeof options.rng === "function" ? options.rng : Math.random;
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  if (tournament.format !== "doubles") return fail(400, "Even teams are for doubles");
  if (tournament.status === "complete") return fail(400, "This tournament is finished");
  if (tournamentHasResults(tournament)) return fail(400, "A match already has a result, so the teams cannot be changed");
  const players = playersFromEntries(db, tournament);
  const pooled = (tournament.poolMode || "none") !== "none";
  const groups = pooled
    ? poolDefs(tournament).map((pool) => ({ id: pool.id, players: players.filter((player) => player.poolId === pool.id) }))
    : [{ id: "all", players }];
  const teams = [];
  for (const group of groups) {
    for (const pair of pairEven(group.players).pairs) {
      teams.push({ playerIds: [Number(pair[0].userId), Number(pair[1].userId)] });
    }
  }
  if (!teams.length) return fail(400, "Need at least two players in a pool to make an even team");
  const saved = saveTournamentTeams(db, id, { teams });
  if (saved.error || !saved.tournament) return saved;
  saved.tournament.wheelReveal = buildWheelReveal(db, saved.tournament, rng);
  return saved;
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

function roundsForMatch(tournament, matchId) {
  for (const draw of drawList(tournament)) {
    if (findMatch(draw.bracket?.rounds, matchId)) return draw.bracket.rounds;
  }
  return null;
}

export function recordTournamentResult(db, id, matchId, body) {
  const tournament = findTournament(db, id);
  if (!tournament) return fail(404, "Tournament not found");
  const rounds = roundsForMatch(tournament, String(matchId || ""));
  if (!rounds) {
    if (!drawList(tournament).length) return fail(400, "Generate the bracket first");
    return fail(404, "Match not found");
  }
  const match = findMatch(rounds, String(matchId || ""));
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
  if (downstreamHasComplete(rounds, match.id)) {
    return fail(400, "A later match already has a result");
  }
  match.status = "complete";
  match.winnerTeamId = winnerTeamId;
  match.scoreA = scores.scoreA;
  match.scoreB = scores.scoreB;
  settleBracket(rounds);
  refreshStatus(tournament);
  return { status: 200, tournament };
}

function teamName(db, team) {
  return (team?.playerIds || [])
    .map((id) => bracketPlayerName(findUser(db, id)))
    .filter(Boolean)
    .join(" & ");
}

function presentTeam(db, tournament, team) {
  if (!team) return null;
  const players = (team.playerIds || []).map((id) => {
    const user = findUser(db, id);
    const entry = (tournament.entries || []).find((item) => Number(item.userId) === Number(id));
    const view = entry ? entrantView(db, entry, tournament) : playerView(user);
    return {
      userId: view.userId,
      name: bracketPlayerName(user),
      avg: view.avg,
      band: view.band,
      bandLabel: view.bandLabel,
    };
  });
  return {
    id: team.id,
    seed: team.seed || null,
    poolId: team.poolId || "all",
    name: players.map((player) => player.name).filter(Boolean).join(" & ") || teamName(db, team) || "Team",
    avg: roundAvg(team.avg),
    playerIds: (team.playerIds || []).map(Number),
    players,
  };
}

function championName(db, tournament) {
  const names = drawList(tournament)
    .map((draw) => {
      const id = championTeamId(draw.bracket);
      if (!id) return "";
      const team = (draw.teams || tournament.teams || []).find((item) => item.id === id);
      const name = team ? teamName(db, team) : "";
      if (!name) return "";
      if ((tournament.poolMode || "none") !== "none" && draw.name) return `${draw.name}: ${name}`;
      return name;
    })
    .filter(Boolean);
  return names.join(" · ");
}

function presentRounds(rounds, teamById) {
  return (rounds || []).map((round) => ({
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
  }));
}

function padPair(ids) {
  const list = (ids || []).map((id) => (id == null || id === "" ? null : Number(id)));
  while (list.length < 2) list.push(null);
  return list.slice(0, 2);
}

function editorCards(db, tournament) {
  if (tournament.format !== "doubles") return [];
  const players = playersFromEntries(db, tournament);
  const byId = new Map(players.map((player) => [player.userId, player]));
  const manual = (tournament.manualTeams || []).filter((team) => (team.playerIds || []).length);
  if (manual.length) {
    return manual.map((team) => ({
      playerIds: padPair(team.playerIds),
      poolId: team.poolId || byId.get(Number(team.playerIds.find(Boolean)))?.poolId || "all",
    }));
  }
  if ((tournament.teams || []).length && drawList(tournament).length) {
    return tournament.teams.map((team) => ({
      playerIds: padPair(team.playerIds),
      poolId: team.poolId || byId.get(Number((team.playerIds || [])[0]))?.poolId || "all",
    }));
  }
  if (tournament.partnerMode !== "choose") return [];
  const drawn = confirmedPairs(tournament.entries, players);
  const cards = [];
  for (const pair of drawn.pairs) {
    if (!pair[0] || !pair[1]) continue;
    cards.push({ playerIds: [Number(pair[0].userId), Number(pair[1].userId)], poolId: pair[0].poolId || "all" });
  }
  for (const player of drawn.unpaired) {
    if (!player) continue;
    cards.push({ playerIds: [Number(player.userId), null], poolId: player.poolId || "all" });
  }
  return cards;
}

function teamPlayerOptions(db, tournament) {
  const split = cutoffOf(tournament);
  return playersFromEntries(db, tournament).map((player) => ({
    userId: player.userId,
    name: player.name,
    avg: player.avg,
    band: player.band,
    bandLabel: bandLabel(player.band, split),
    poolId: player.poolId || "all",
    poolName: poolNameOf(tournament, player.poolId),
    divisionLabel: joinNames(player.leagueIds.map((id) => divisionName(findLeague(db, id)))) || "No division",
  }));
}

function entryLabel(db, tournament) {
  const ids = (tournament.leagueIds || []).map(Number);
  if (!ids.length) return "All players";
  const names = ids.map((id) => divisionName(findLeague(db, id)));
  if (names.length === 1) return `${names[0]} only`;
  return joinNames(names);
}

function viewerInField(viewer, tournament) {
  const limits = (tournament.leagueIds || []).map(Number);
  if (!limits.length) return true;
  return userLeagueIds(viewer).some((id) => limits.includes(id));
}

function viewerBand(viewer, tournament) {
  if (!viewer) return null;
  const view = playerView(viewer);
  const split = cutoffOf(tournament);
  const band = avgBand(view.avg, split);
  return { ...view, band, bandLabel: bandLabel(band, split) };
}

function statusRank(status) {
  if (status === "open") return 0;
  if (status === "brackets") return 1;
  if (status === "complete") return 2;
  return 9;
}

function presentWheel(entryViews, tournament) {
  if (drawList(tournament).length) return null;
  const live = entryViews
    .map((entry) => ({ userId: Number(entry.userId), name: entry.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId - b.userId);
  const reveal = tournament.wheelReveal;
  if (!reveal || !Array.isArray(reveal.order) || !reveal.order.length) return { players: live, reveal: null };
  const step = Number(reveal.stepMs) || wheelStepMs(reveal.order.length);
  const started = Date.parse(reveal.startedAt);
  const playing = Number.isFinite(started) && Date.now() < started + reveal.order.length * step + 800;
  const frozen = Array.isArray(reveal.players) ? reveal.players : null;
  return {
    players: playing && frozen?.length ? frozen.map((player) => ({ userId: Number(player.userId), name: String(player.name || "Player") })) : live,
    reveal: {
      id: String(reveal.id),
      startedAt: reveal.startedAt,
      stepMs: step,
      order: reveal.order.map(Number),
      pairs: (reveal.pairs || []).map((pair) => (pair || []).map(Number)),
      satOut: (reveal.satOut || []).map((person) => ({ userId: Number(person.userId), name: String(person.name || "Player") })),
    },
  };
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
    leagueIds: (tournament.leagueIds || []).map(Number),
    entryLabel: entryLabel(db, tournament),
    poolMode: tournament.poolMode || "none",
    avgSplit: tournament.avgSplit ?? AVG_SPLIT,
    eligible: viewerInField(viewer, tournament),
    championName: championName(db, tournament),
    viewer: viewerBand(viewer, tournament),
  };
  if (!detail) return base;

  const entryViews = entries.map((entry) => entrantView(db, entry, tournament));
  const pooled = (tournament.poolMode || "none") !== "none";
  const draws = pooled
    ? drawList(tournament).map((draw) => {
        const drawTeams = (draw.teams || []).map((team) => presentTeam(db, tournament, team));
        const byId = new Map(drawTeams.map((team) => [team.id, team]));
        const winnerId = championTeamId(draw.bracket);
        return {
          poolId: draw.poolId,
          name: draw.name,
          teams: drawTeams,
          championName: drawTeams.find((team) => team.id === winnerId)?.name || "",
          bracket: { size: draw.bracket.size, rounds: presentRounds(draw.bracket.rounds, byId) },
        };
      })
    : [];
  const teams = pooled ? draws.flatMap((draw) => draw.teams) : (tournament.teams || []).map((team) => presentTeam(db, tournament, team));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const teamed = new Set(teams.flatMap((team) => team.playerIds));
  const incoming = mine
    ? entries
        .filter((entry) => Number(entry.partnerRequestUserId) === meId)
        .map((entry) => entrantView(db, entry, tournament))
    : [];
  const meView = mine ? entryViews.find((entry) => Number(entry.userId) === meId) || null : null;
  const partnerChoices =
    viewer && tournament.format === "doubles" && tournament.partnerMode === "choose" && tournament.status === "open" && mine && !mine.confirmedPartnerUserId
      ? entryViews.filter(
          (entry) =>
            Number(entry.userId) !== meId &&
            !entry.confirmedPartnerUserId &&
            ((tournament.poolMode || "none") === "none" || entry.poolId === meView?.poolId)
        )
      : [];
  const bracket =
    !pooled && tournament.bracket
      ? { size: tournament.bracket.size, rounds: presentRounds(tournament.bracket.rounds, teamById) }
      : null;
  const high = entryViews.filter((entry) => entry.band === "high").length;
  const editable = Boolean(canManage) && tournament.format === "doubles" && !tournamentHasResults(tournament) && tournament.status !== "complete";
  return {
    ...base,
    entries: entryViews,
    teams,
    bracket,
    draws,
    unpaired: drawList(tournament).length ? entryViews.filter((entry) => !teamed.has(Number(entry.userId))) : [],
    bandCounts: { high, low: entryViews.length - high },
    pools: (tournament.pools || []).map((pool) => ({
      id: pool.id,
      name: pool.name,
      leagueIds: (pool.leagueIds || []).map(Number),
      divisionNames: (pool.leagueIds || []).map((id) => divisionName(findLeague(db, id))),
    })),
    poolCounts: pooled
      ? poolDefs(tournament).map((pool) => ({
          id: pool.id,
          name: pool.name,
          count: entryViews.filter((entry) => entry.poolId === pool.id).length,
        }))
      : [],
    partnerChoices,
    me: meView ? { ...meView, incoming } : null,
    teamsLocked: tournamentHasResults(tournament),
    teamEdits: (tournament.manualTeams || []).some((team) => (team.playerIds || []).length),
    teamCards: editable ? editorCards(db, tournament) : [],
    teamPlayers: editable ? teamPlayerOptions(db, tournament) : [],
    wheel: presentWheel(entryViews, tournament),
  };
}

export function listTournaments(db, viewer, canManage) {
  const flag = typeof canManage === "function" ? canManage : () => Boolean(canManage);
  return ensureList(db)
    .map((tournament) => publicTournament(db, tournament, viewer, { detail: false, canManage: flag(tournament) }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || String(a.startsAt).localeCompare(String(b.startsAt)) || b.id - a.id);
}
