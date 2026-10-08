// A player on the injured list still belongs to the division.
// Placing them there opens a vacancy for their fixtures.
// The ids are only kept for leagues they are actually in, so a later
// unplace or move drops the flag.

export function injuredLeagueIds(user) {
  const placed = new Set(
    Array.isArray(user?.leagueIds)
      ? user.leagueIds.map(Number).filter(Boolean)
      : user?.leagueId
        ? [Number(user.leagueId)]
        : []
  );
  const raw = Array.isArray(user?.injuredLeagueIds) ? user.injuredLeagueIds : [];
  return [...new Set(raw.map(Number).filter((id) => placed.has(id)))];
}

export function isInjuredIn(user, leagueId) {
  return injuredLeagueIds(user).includes(Number(leagueId));
}
