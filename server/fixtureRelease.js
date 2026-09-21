/** Week-by-week public fixture release.
 *
 * Players and the public only see a week from 00:00 GMT on the Sunday that
 * week begins. Admin desks still list every generated match.
 */

export function sundayStartGmt(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").slice(0, 10));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

export function fixtureReleaseAt(fixture) {
  if (!fixture) return null;
  return sundayStartGmt(fixture.weekStart || fixture.date);
}

export function isFixtureReleased(fixture, now = new Date()) {
  if (!fixture) return false;
  if (fixture.status === "played" || fixture.status === "submitted") return true;
  const at = fixtureReleaseAt(fixture);
  if (!at) return true;
  return now.getTime() >= at.getTime();
}

export function releasedFixtures(fixtures, now = new Date()) {
  return (fixtures || []).filter((f) => isFixtureReleased(f, now));
}

export function nextFixtureReleaseAt(fixtures, now = new Date()) {
  let next = null;
  for (const f of fixtures || []) {
    if (isFixtureReleased(f, now)) continue;
    const at = fixtureReleaseAt(f);
    if (!at) continue;
    if (!next || at.getTime() < next.getTime()) next = at;
  }
  return next;
}

export function fixturePublishMeta(fixtures, now = new Date()) {
  const next = nextFixtureReleaseAt(fixtures, now);
  return { nextFixtureReleaseAt: next ? next.toISOString() : null };
}
