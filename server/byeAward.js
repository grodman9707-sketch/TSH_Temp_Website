/** Default 5–0 for a bye, awarded when the next week is released.
 *
 * A week 4 bye stays a bye during week 4. It becomes a 5–0 win for the
 * player who is there at 00:00 GMT on the Sunday week 5 is released. If that
 * next week is dated later than seven days on, the win waits for it. Filling
 * the open spot clears the default and the match is played for a real result.
 */

import { fixtureReleaseAt } from "./fixtureRelease.js";

export const BYE_WIN_LEGS = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function seasonOf(fixture) {
  return Number(fixture?.season || 1);
}

function nextWeekRelease(fixture, fixtures) {
  const week = Number(fixture?.week);
  if (!Number.isInteger(week) || week < 1) return null;
  const leagueId = Number(fixture.leagueId);
  const season = seasonOf(fixture);
  const want = week + 1;
  let at = null;
  for (const other of fixtures || []) {
    if (Number(other?.id) === Number(fixture.id)) continue;
    if (Number(other?.leagueId) !== leagueId) continue;
    if (seasonOf(other) !== season) continue;
    if (Number(other?.week) !== want) continue;
    const release = fixtureReleaseAt(other);
    if (!release) continue;
    if (!at || release.getTime() < at.getTime()) at = release;
  }
  return at;
}

/** When this bye's default win lands. Null when the bye has no week date. */
export function byeAwardAt(fixture, fixtures = []) {
  const own = fixtureReleaseAt(fixture);
  if (!own) return null;
  const earliest = new Date(own.getTime() + WEEK_MS);
  const next = nextWeekRelease(fixture, fixtures);
  if (next && next.getTime() > earliest.getTime()) return next;
  return earliest;
}

export function isOpenBye(fixture) {
  if (!fixture) return false;
  if (fixture.byeAwarded && fixture.status === "played") return false;
  if (!(fixture.bye || fixture.status === "bye")) return false;
  if (fixture.status === "played" || fixture.status === "submitted" || fixture.status === "pending_verify") return false;
  const home = Number(fixture.homeId) || 0;
  const away = Number(fixture.awayId) || 0;
  return Boolean(home) !== Boolean(away);
}

export function byeAwardDue(fixture, fixtures, now = new Date()) {
  if (!isOpenBye(fixture)) return false;
  const at = byeAwardAt(fixture, fixtures);
  if (!at) return false;
  return now.getTime() >= at.getTime();
}

export function awardByeWin(fixture, fixtures, now = new Date()) {
  if (!byeAwardDue(fixture, fixtures, now)) return false;
  const home = Number(fixture.homeId) || 0;
  const away = Number(fixture.awayId) || 0;
  fixture.byeAwarded = true;
  fixture.byeAwardedAt = now.toISOString();
  fixture.bye = false;
  fixture.status = "played";
  fixture.homeLegs = home ? BYE_WIN_LEGS : 0;
  fixture.awayLegs = away ? BYE_WIN_LEGS : 0;
  fixture.confirmedBy = null;
  fixture.confirmedAt = fixture.byeAwardedAt;
  return true;
}

export function awardDueByeWins(db, now = new Date()) {
  const fixtures = db?.fixtures || [];
  let changed = 0;
  for (const fixture of fixtures) {
    if (awardByeWin(fixture, fixtures, now)) changed += 1;
  }
  return changed;
}

/** Drop a default bye win so the match can take a real result. */
export function clearByeAward(fixture) {
  if (!fixture?.byeAwarded) return false;
  fixture.byeAwarded = false;
  fixture.byeAwardedAt = null;
  fixture.confirmedBy = null;
  fixture.confirmedAt = null;
  fixture.homeLegs = null;
  fixture.awayLegs = null;
  fixture.status = "scheduled";
  fixture.bye = false;
  return true;
}
