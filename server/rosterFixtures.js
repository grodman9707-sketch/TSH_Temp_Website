/**
 * Every player on a division roster should appear once in each week that
 * division already has fixtures for. A player who is the only one missing
 * from a week gets that week as a bye. Scores and existing matches are not
 * changed. This is safe to run once: after the bye exists the player is no
 * longer missing, and a later delete is not recreated.
 */
export function fillMissingRosterByes(db) {
  if (!db || !Array.isArray(db.fixtures) || !Array.isArray(db.users)) return 0;
  const groups = new Map();
  for (const fixture of db.fixtures) {
    const key = `${Number(fixture.leagueId)}|${Number(fixture.season || 1)}|${Number(fixture.week)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fixture);
  }
  let nextId = Math.max(0, ...db.fixtures.map((fixture) => Number(fixture.id) || 0));
  let created = 0;
  for (const [key, list] of groups) {
    const [leagueId, season, week] = key.split("|").map(Number);
    const roster = db.users.filter((user) => {
      const ids = Array.isArray(user.leagueIds) ? user.leagueIds : user.leagueId ? [user.leagueId] : [];
      return ids.map(Number).includes(leagueId);
    });
    if (roster.length < 2) continue;
    const seen = new Map();
    for (const fixture of list) {
      if (fixture.homeId) seen.set(Number(fixture.homeId), (seen.get(Number(fixture.homeId)) || 0) + 1);
      if (fixture.awayId) seen.set(Number(fixture.awayId), (seen.get(Number(fixture.awayId)) || 0) + 1);
    }
    if ([...seen.values()].some((count) => count > 1)) continue;
    const missing = roster.filter((user) => !seen.has(Number(user.id)));
    if (missing.length !== 1) continue;
    const starts = list.map((fixture) => String(fixture.weekStart || fixture.date || "").slice(0, 10)).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    const weekStart = mode(starts);
    if (!weekStart) continue;
    const player = missing[0];
    nextId += 1;
    db.fixtures.push({
      id: nextId,
      leagueId,
      season,
      week,
      homeId: player.id,
      awayId: null,
      bye: true,
      status: "bye",
      date: weekStart,
      weekStart,
      time: "",
      homeLegs: null,
      awayLegs: null,
    });
    created += 1;
  }
  return created;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
