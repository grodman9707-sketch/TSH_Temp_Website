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
