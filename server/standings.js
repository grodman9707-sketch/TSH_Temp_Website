// Division tables list whoever is in that division now.
// Each row is that player's own published results from the same regional,
// so a move between divisions carries the record onto the new table.
// The opponent who stayed keeps their side of the result where they are listed.

function userLeagueIds(user) {
  if (Array.isArray(user?.leagueIds)) return [...new Set(user.leagueIds.map(Number).filter(Boolean))];
  if (user?.leagueId) return [Number(user.leagueId)];
  return [];
}

function inLeague(user, leagueId) {
  return userLeagueIds(user).includes(Number(leagueId));
}

function regionalLeagueIds(db, leagueId) {
  const league = (db.leagues || []).find((item) => Number(item.id) === Number(leagueId));
  const regionalId = Number(league?.regionalId);
  const ids = (db.leagues || [])
    .filter((item) => Number(item.regionalId) === regionalId)
    .map((item) => Number(item.id))
    .filter(Boolean);
  return new Set(ids.length ? ids : [Number(leagueId)]);
}

function addSide(row, legsFor, legsAgainst, avg, oneEighties) {
  const scoredFor = Number(legsFor) || 0;
  const scoredAgainst = Number(legsAgainst) || 0;
  row.played += 1;
  row.legsFor += scoredFor;
  row.legsAgainst += scoredAgainst;
  row.oneEighties += Number(oneEighties) || 0;
  if (Number(avg)) {
    row.matchAvgSum += Number(avg);
    row.matchAvgCount += 1;
  }
  row.points += scoredFor;
  if (scoredFor > scoredAgainst) {
    row.won += 1;
    row.points += 2;
  } else if (scoredAgainst > scoredFor) {
    row.lost += 1;
  }
}

export function standingsForLeague(db, leagueId) {
  const countedLeagues = regionalLeagueIds(db, leagueId);
  const players = (db.users || []).filter((user) => inLeague(user, leagueId));
  const rows = players.map((player) => ({
    playerId: player.id,
    name: player.name,
    nickname: player.nickname || "",
    hasAvatar: Boolean(player.avatarFile),
    avg: player.avg,
    played: 0,
    won: 0,
    lost: 0,
    legsFor: 0,
    legsAgainst: 0,
    points: 0,
    oneEighties: 0,
    matchAvgSum: 0,
    matchAvgCount: 0,
  }));
  const byId = Object.fromEntries(rows.map((row) => [row.playerId, row]));
  for (const fixture of db.fixtures || []) {
    if (fixture.status !== "played") continue;
    if (!countedLeagues.has(Number(fixture.leagueId))) continue;
    const home = byId[fixture.homeId];
    const away = byId[fixture.awayId];
    if (home) addSide(home, fixture.homeLegs, fixture.awayLegs, fixture.homeAvg, fixture.home180 || fixture.homeOneEighties || 0);
    if (away) addSide(away, fixture.awayLegs, fixture.homeLegs, fixture.awayAvg, fixture.away180 || fixture.awayOneEighties || 0);
  }
  return rows
    .map((row) => {
      const { matchAvgSum, matchAvgCount, ...rest } = row;
      return {
        ...rest,
        diff: row.legsFor - row.legsAgainst,
        avg: matchAvgCount ? Math.round((matchAvgSum / matchAvgCount) * 10) / 10 : row.avg,
      };
    })
    .sort((a, b) => b.points - a.points || b.diff - a.diff || b.legsFor - a.legsFor);
}
