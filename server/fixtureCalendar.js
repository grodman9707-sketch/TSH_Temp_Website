import { addDays } from "./season.js";

/** Statuses that have not been played and can still move with the week grid. */
const MOVABLE = new Set(["scheduled", "bye"]);

function dayDiff(later, earlier) {
  const a = Date.parse(`${String(later || "").slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(earlier || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

function mode(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
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

/**
 * Pull a division's unplayed week back by 7 days when that week starts exactly
 * one week later than the same week number in the other divisions.
 *
 * Division 2 was regenerated on 28 Sep 2026 with that day as the start date,
 * after weeks 1 and 2 had already been played from 21 Sep. The new week 3
 * landed on 12 Oct, so it stays unreleased until the Sunday of 11 Oct while
 * every other division's week 3 (5 Oct) released on 4 Oct. Played matches,
 * submitted matches, and any date that is not exactly 7 days late are left
 * alone. Running this again after the shift is a no-op.
 */
export function alignLaggingDivisionWeeks(fixtures) {
  const list = Array.isArray(fixtures) ? fixtures : [];
  const leagueStarts = new Map();
  for (const fixture of list) {
    const start = String(fixture.weekStart || fixture.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const key = `${Number(fixture.season || 1)}|${Number(fixture.week)}|${Number(fixture.leagueId)}`;
    if (!leagueStarts.has(key)) leagueStarts.set(key, []);
    leagueStarts.get(key).push(start);
  }
  const weekVotes = new Map();
  for (const [key, starts] of leagueStarts) {
    const chosen = mode(starts);
    if (!chosen) continue;
    const weekKey = key.split("|").slice(0, 2).join("|");
    if (!weekVotes.has(weekKey)) weekVotes.set(weekKey, []);
    weekVotes.get(weekKey).push(chosen);
  }
  const reference = new Map();
  for (const [weekKey, starts] of weekVotes) reference.set(weekKey, mode(starts));

  let moved = 0;
  for (const fixture of list) {
    if (!MOVABLE.has(fixture.status)) continue;
    const start = String(fixture.weekStart || fixture.date || "").slice(0, 10);
    const weekKey = `${Number(fixture.season || 1)}|${Number(fixture.week)}`;
    const target = reference.get(weekKey);
    if (!target || dayDiff(start, target) !== 7) continue;
    const next = addDays(start, -7);
    const date = String(fixture.date || "").slice(0, 10);
    const offset = dayDiff(date, start);
    fixture.weekStart = next;
    if (!date || date === start) fixture.date = next;
    else if (offset != null && offset >= 0 && offset < 7) fixture.date = addDays(next, offset);
    moved += 1;
  }
  return moved;
}
