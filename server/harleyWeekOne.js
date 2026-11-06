// Jamie Hyde took Harley Jackson's Division 4 spot from week 2. Harley's
// week 1 loss stayed on the deleted account, so Jamie was one match short.
// This moves that 5–0 onto Jamie. Legs stay. Harley's average, 180s, and
// checkout do not.

function compactName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function identityNames(user) {
  return [user?.name, user?.nickname, user?.dartcounterName].map(compactName).filter(Boolean);
}

function userInLeague(user, leagueId) {
  const ids = Array.isArray(user?.leagueIds) ? user.leagueIds : user?.leagueId ? [user.leagueId] : [];
  return ids.map(Number).includes(Number(leagueId));
}

function sideLabels(db, fixture, side) {
  const id = side === "home" ? fixture?.homeId : fixture?.awayId;
  const archive = side === "home" ? fixture?.homeArchiveName : fixture?.awayArchiveName;
  const user = (db.users || []).find((item) => Number(item.id) === Number(id));
  return [compactName(archive), ...(user ? identityNames(user) : [])].filter(Boolean);
}

function legCount(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

function clearSidePerformance(fixture, side) {
  const prefix = side === "home" ? "home" : "away";
  fixture[`${prefix}Avg`] = 0;
  fixture[`${prefix}Checkout`] = 0;
  fixture[`${prefix}BestLeg`] = null;
  for (const band of [60, 80, 100, 120, 140, 160, 180]) fixture[`${prefix}${band}`] = 0;
  fixture[`${prefix}OneEighties`] = 0;
  if (prefix === "home") fixture.home180 = 0;
  else fixture.away180 = 0;
  const home180s = Number(fixture.home180 || fixture.homeOneEighties) || 0;
  const away180s = Number(fixture.away180 || fixture.awayOneEighties) || 0;
  fixture.oneEighties = home180s + away180s;
  fixture.topCheckout = Math.max(Number(fixture.homeCheckout) || 0, Number(fixture.awayCheckout) || 0);
}

export function giveHarleyWeekOneToJamie(db) {
  const jamies = (db?.users || []).filter((user) => identityNames(user).includes("jamie hyde"));
  let moved = 0;
  for (const fixture of db?.fixtures || []) {
    if (fixture?.status !== "played" || Number(fixture.week) !== 1) continue;
    const homeHarley = sideLabels(db, fixture, "home").includes("harley jackson");
    const awayHarley = sideLabels(db, fixture, "away").includes("harley jackson");
    if (homeHarley === awayHarley) continue;
    const side = homeHarley ? "home" : "away";
    const harleyLegs = legCount(side === "home" ? fixture.homeLegs : fixture.awayLegs);
    const otherLegs = legCount(side === "home" ? fixture.awayLegs : fixture.homeLegs);
    if (harleyLegs !== 0 || otherLegs !== 5) continue;
    const placed = jamies.filter((user) => userInLeague(user, fixture.leagueId));
    if (placed.length !== 1) continue;
    const jamie = placed[0];
    const currentId = Number(side === "home" ? fixture.homeId : fixture.awayId);
    if (currentId === Number(jamie.id)) continue;
    if (side === "home") {
      fixture.homeId = jamie.id;
      fixture.homeArchiveName = "";
    } else {
      fixture.awayId = jamie.id;
      fixture.awayArchiveName = "";
    }
    clearSidePerformance(fixture, side);
    moved += 1;
  }
  return moved;
}
