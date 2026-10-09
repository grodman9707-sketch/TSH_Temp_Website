// Players offered in Owner desk → Place a player.
// Only people who are not in a division yet, one row per real player.

function normIdent(value) {
  return String(value || "").trim().toLowerCase();
}

function leagueIdsOf(user) {
  if (Array.isArray(user?.leagueIds)) {
    return [...new Set(user.leagueIds.map(Number).filter(Boolean))];
  }
  if (user?.leagueId) return [Number(user.leagueId)];
  return [];
}

function identityKeys(user) {
  const keys = [];
  const email = normIdent(user?.email);
  const dartcounter = normIdent(user?.dartcounterName);
  const username = normIdent(user?.username);
  if (email) keys.push(`email:${email}`);
  if (dartcounter) keys.push(`dc:${dartcounter}`);
  if (username) keys.push(`user:${username}`);
  keys.push(`id:${Number(user?.id)}`);
  return keys;
}

function accountScore(user) {
  let score = 0;
  if (user?.hasPendingApplication) score += 4;
  if (Number(user?.avg)) score += 2;
  if (normIdent(user?.dartcounterName)) score += 1;
  return score;
}

function preferAccount(a, b) {
  const byScore = accountScore(b) - accountScore(a);
  if (byScore) return byScore;
  return Number(a.id) - Number(b.id);
}

export function formatThreeDartAvg(avg) {
  const n = Number(avg);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round((n + Number.EPSILON) * 100) / 100);
}

export function placePlayerOptionLabel(player, { duplicateName = false, roles = [] } = {}) {
  const name = String(player?.name || "Player").trim() || "Player";
  const tag = roles.length ? ` · ${roles.join(" · ")}` : "";
  const dc = String(player?.dartcounterName || "").trim();
  const dcBit = duplicateName && dc && normIdent(dc) !== normIdent(name) ? ` · ${dc}` : "";
  const email = String(player?.email || "").trim();
  const emailBit = duplicateName && !dcBit && email ? ` · ${email}` : "";
  return `${name}${tag} · 3DA ${formatThreeDartAvg(player?.avg)}${dcBit}${emailBit}`;
}

export function unplacedPlaceChoices(users) {
  const candidates = [];
  const seenIds = new Set();
  for (const user of users || []) {
    if (!user || leagueIdsOf(user).length) continue;
    const id = Number(user.id);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    candidates.push(user);
  }

  const parent = new Map();
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    const next = parent.get(key);
    if (next !== key) {
      const root = find(next);
      parent.set(key, root);
      return root;
    }
    return key;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };

  for (const user of candidates) {
    const keys = identityKeys(user);
    for (let i = 1; i < keys.length; i += 1) union(keys[0], keys[i]);
  }

  const groups = new Map();
  for (const user of candidates) {
    const root = find(identityKeys(user)[0]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(user);
  }

  const chosen = [];
  for (const group of groups.values()) {
    group.sort(preferAccount);
    chosen.push(group[0]);
  }
  chosen.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }) || Number(a.id) - Number(b.id));
  return chosen;
}

export function uniqueOpenSeats(seats) {
  const seen = new Set();
  const rows = [];
  for (const seat of seats || []) {
    const who = seat?.userId ? `id:${Number(seat.userId)}` : `name:${normIdent(seat?.playerName)}`;
    const key = `${Number(seat?.leagueId)}:${who}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(seat);
  }
  return rows;
}

export function openSpotLabel(count) {
  const n = Number(count) || 0;
  return n === 1 ? "1 spot to fill" : `${n} spots to fill`;
}

export function divisionShortLabel(league) {
  const name = String(league?.leagueTitle || league?.title || league?.name || "");
  const match = name.match(/Division\s+(\d+)/i);
  if (match) return `Div-${match[1]}`;
  return name.replace(/^TSH\s+/i, "").trim() || "Division";
}

function leagueIdsOfUser(user) {
  if (Array.isArray(user?.leagueIds)) return user.leagueIds.map(Number).filter(Boolean);
  if (user?.leagueId) return [Number(user.leagueId)];
  return [];
}

function isInjuredInLeague(user, leagueId) {
  const placed = new Set(leagueIdsOfUser(user));
  const raw = Array.isArray(user?.injuredLeagueIds) ? user.injuredLeagueIds : [];
  return raw.map(Number).filter((id) => placed.has(id)).includes(Number(leagueId));
}

// One card per division: short name, spots still open, who is playing, who is injured.
export function divisionSpotCards(seats, leagues, users) {
  return openSpotsByDivision(seats, leagues).map((row) => {
    const inDivision = (users || []).filter((user) => leagueIdsOfUser(user).includes(Number(row.leagueId)));
    const injured = inDivision.filter((user) => isInjuredInLeague(user, row.leagueId)).length;
    return {
      ...row,
      shortLabel: divisionShortLabel(row),
      filled: inDivision.length - injured,
      injured,
    };
  });
}

// One open spot is one player who can still be replaced in that division.
// The count is what staff see. The departed player's name stays off the desk.
export function openSpotsByDivision(seats, leagues) {
  const unique = uniqueOpenSeats(seats);
  const counts = new Map();
  for (const seat of unique) {
    const id = Number(seat?.leagueId);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const rows = [];
  const seen = new Set();
  for (const league of leagues || []) {
    const id = Number(league?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      leagueId: id,
      leagueTitle: String(league.title || league.name || "Division"),
      openSpots: counts.get(id) || 0,
    });
  }
  for (const seat of unique) {
    const id = Number(seat?.leagueId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      leagueId: id,
      leagueTitle: String(seat.leagueTitle || "Division"),
      openSpots: counts.get(id) || 0,
    });
  }
  return rows;
}
