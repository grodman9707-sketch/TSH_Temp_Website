// Group released fixtures into weeks so the fixtures tab can show the current
// week and keep earlier weeks in a menu.

export function fixtureWeekKey(fixture) {
  const season = Number(fixture?.season || 1) || 1;
  const week = Number(fixture?.week || 0) || 0;
  return season === 1 ? String(week) : `${season}-${week}`;
}

function ymd(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function compareFixtureWeeks(a, b) {
  const as = a.weekStart || "";
  const bs = b.weekStart || "";
  if (as && bs && as !== bs) return as < bs ? -1 : 1;
  if (as && !bs) return -1;
  if (!as && bs) return 1;
  if (a.season !== b.season) return a.season - b.season;
  return a.week - b.week;
}

export function fixtureWeekGroups(fixtures) {
  const map = new Map();
  for (const fixture of fixtures || []) {
    const key = fixtureWeekKey(fixture);
    const season = Number(fixture.season || 1) || 1;
    const week = Number(fixture.week || 0) || 0;
    const start = ymd(fixture.weekStart || fixture.date);
    if (!map.has(key)) map.set(key, { key, season, week, weekStart: start, fixtures: [] });
    const group = map.get(key);
    if (start && (!group.weekStart || start < group.weekStart)) group.weekStart = start;
    group.fixtures.push(fixture);
  }
  return [...map.values()].sort(compareFixtureWeeks);
}

export function currentFixtureWeek(groups, now = new Date()) {
  const list = groups || [];
  if (!list.length) return null;
  const today = now.toISOString().slice(0, 10);
  const started = list.filter((group) => !group.weekStart || group.weekStart <= today);
  const pool = started.length ? started : list;
  return pool.reduce((best, group) => (compareFixtureWeeks(group, best) > 0 ? group : best));
}

export function previousFixtureWeeks(groups, current) {
  if (!current) return [];
  return (groups || [])
    .filter((group) => group.key !== current.key && compareFixtureWeeks(group, current) < 0)
    .sort((a, b) => compareFixtureWeeks(b, a));
}

export function selectFixtureWeek(groups, selectedKey, now = new Date()) {
  const current = currentFixtureWeek(groups, now);
  const previous = previousFixtureWeeks(groups, current);
  const later = (groups || [])
    .filter((group) => current && group.key !== current.key && compareFixtureWeeks(group, current) > 0)
    .sort(compareFixtureWeeks);
  const menu = [...previous, ...later];
  const picked = selectedKey ? menu.find((group) => group.key === String(selectedKey)) || null : null;
  return { current, previous, later, menu, picked, shown: picked || current };
}

export function formatWeekDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd(value));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function fixtureWeekTitle(group) {
  if (!group) return "";
  const season = group.season && Number(group.season) !== 1 ? `Season ${group.season} · ` : "";
  const when = formatWeekDate(group.weekStart);
  return `${season}Week ${group.week}${when ? ` · ${when}` : ""}`;
}
