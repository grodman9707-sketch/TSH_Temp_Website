// Timezone helpers shared by the API and the notification engine.
//
// Match times are stored as an absolute instant (`fixture.startAt`, ISO UTC) so
// they can be rendered in each viewer's own local timezone. These helpers convert
// a wall-clock time in a named IANA zone to that absolute instant (DST-safe).

// Offset (ms) that `timeZone` is ahead of UTC at the given instant.
export function zoneOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - instant.getTime();
}

// Interpret a wall-clock date/time in `timeZone` and return the UTC instant.
// Two passes handle daylight-saving boundaries.
export function zonedWallTimeToUtc(y, mo, d, h, mi, timeZone) {
  const base = Date.UTC(y, mo - 1, d, h, mi);
  let ts = base - zoneOffsetMs(new Date(base), timeZone);
  const o2 = zoneOffsetMs(new Date(ts), timeZone);
  const ts2 = base - o2;
  if (ts2 !== ts) ts = ts2;
  return new Date(ts);
}

export function zonedYmd(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  return { y: +p.year, mo: +p.month, d: +p.day };
}

// "YYYY-MM-DD" + "HH:MM" in `timeZone` -> UTC Date (or null if unparseable).
export function wallStringToUtc(dateStr, timeStr, timeZone) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || ""));
  if (!dm || !tm) return null;
  return zonedWallTimeToUtc(+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], timeZone);
}

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Fallback zone when a player's own timezone isn't known yet.
export function defaultTimezoneForRegional(regionalChoice) {
  return String(regionalChoice) === "americas" ? "America/New_York" : "Europe/London";
}
