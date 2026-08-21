// Unit tests for the match-notification engine. Run: `node server/notifications.test.js`
// Uses the console dev-fallback (no EMAIL_API_KEY), so nothing is actually sent.
import { runDueNotifications } from "./notifications.js";

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok  - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

// Express a London wall-clock date/time for a given instant, matching how the
// engine interprets fixture.date / fixture.time.
function londonParts(instant) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = {};
  for (const x of dtf.formatToParts(instant)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

const now = new Date("2026-08-20T12:00:00Z");
const stamped = { newHomeAt: "seen", newAwayAt: "seen", weekHomeAt: "seen", weekAwayAt: "seen", remind30At: null };
// Suppress the scheduled-alert so weekly/reminder-focused fixtures stay isolated.
const noNew = { newHomeAt: "seen", newAwayAt: "seen", weekHomeAt: null, weekAwayAt: null, remind30At: null };

const soon = londonParts(new Date(now.getTime() + 20 * 60000)); // +20 min
const later = londonParts(new Date(now.getTime() + 90 * 60000)); // +90 min
const in2days = londonParts(new Date(now.getTime() + 2 * 86400000)).date;
const in3days = londonParts(new Date(now.getTime() + 3 * 86400000)).date;
const nextMonth = londonParts(new Date(now.getTime() + 40 * 86400000)).date;

const db = {
  leagues: [{ id: 1, name: "League 1" }],
  users: [
    { id: 1, name: "A", email: "a@x.com", notifyPrefs: { email: true } },
    { id: 2, name: "B", email: "b@x.com", notifyPrefs: { email: true } },
    { id: 3, name: "C", email: "c@x.com", notifyPrefs: { email: true } },
    { id: 4, name: "D", email: "d@x.com", notifyPrefs: { email: true } },
    { id: 5, name: "E", email: "e@x.com", notifyPrefs: { email: true } },
    { id: 6, name: "F", email: "f@x.com", notifyPrefs: { email: true } },
    { id: 7, name: "G-optout", email: "g@x.com", notifyPrefs: { email: false } },
    { id: 8, name: "H", email: "h@x.com", notifyPrefs: { email: true } },
  ],
  fixtures: [
    // F1: match in 2 days -> weekly for both, no reminder (not agreed).
    { id: 1, leagueId: 1, week: 3, homeId: 1, awayId: 2, status: "scheduled", scheduleStatus: null, date: in2days, time: "", notify: { ...noNew } },
    // F2: agreed, starts in 20 min -> reminder for both (weekly already sent).
    { id: 2, leagueId: 1, week: 3, homeId: 3, awayId: 4, status: "scheduled", scheduleStatus: "agreed", date: soon.date, time: soon.time, notify: { ...stamped } },
    // F3: agreed, starts in 90 min -> nothing yet (weekly already sent).
    { id: 3, leagueId: 1, week: 3, homeId: 5, awayId: 6, status: "scheduled", scheduleStatus: "agreed", date: later.date, time: later.time, notify: { ...stamped } },
    // F4: played -> nothing.
    { id: 4, leagueId: 1, week: 2, homeId: 1, awayId: 3, status: "played", scheduleStatus: "agreed", date: soon.date, time: soon.time },
    // F5: match in 3 days, one player opted out -> weekly for H only.
    { id: 5, leagueId: 1, week: 3, homeId: 7, awayId: 8, status: "scheduled", scheduleStatus: null, date: in3days, time: "", notify: { ...noNew } },
    // F6: match next month -> outside the 7-day window, nothing.
    { id: 6, leagueId: 1, week: 8, homeId: 1, awayId: 5, status: "scheduled", scheduleStatus: null, date: nextMonth, time: "", notify: { ...noNew } },
    // F7: brand-new fixture (newHomeAt/newAwayAt null) -> "scheduled" alert to both.
    { id: 7, leagueId: 1, week: 9, homeId: 1, awayId: 2, status: "scheduled", scheduleStatus: null, date: nextMonth, time: "", notify: { newHomeAt: null, newAwayAt: null, weekHomeAt: "seen", weekAwayAt: "seen", remind30At: null } },
  ],
};

console.log("Run 1 (first pass):");
const r1 = runDueNotifications(db, now);
const weekly = r1.outbox.filter((m) => m.type === "weekly");
const reminders = r1.outbox.filter((m) => m.type === "reminder");

const scheduled = r1.outbox.filter((m) => m.type === "new_match");
check("brand-new fixture sends a 'scheduled' alert to both players", scheduled.filter((m) => m.fixtureId === 7).length === 2);
check("no 'scheduled' alert for fixtures already marked as seen", scheduled.filter((m) => m.fixtureId !== 7).length === 0);
check("2 weekly emails for the in-2-days match", weekly.filter((m) => m.fixtureId === 1).length === 2);
check("2 reminder emails for the match starting in 20 min", reminders.filter((m) => m.fixtureId === 2).length === 2);
check("no emails for the match 90 min away", r1.outbox.filter((m) => m.fixtureId === 3).length === 0);
check("no emails for the played match", r1.outbox.filter((m) => m.fixtureId === 4).length === 0);
check("opted-out player gets no email, opted-in partner does", r1.outbox.filter((m) => m.fixtureId === 5).length === 1 && r1.outbox.some((m) => m.fixtureId === 5 && m.to === "h@x.com"));
check("no emails for the match a month out", r1.outbox.filter((m) => m.fixtureId === 6).length === 0);
check("db reported as changed", r1.changed === true);
check("opted-out fixture still stamped both weekly markers", db.fixtures[4].notify.weekHomeAt && db.fixtures[4].notify.weekAwayAt);
check("reminder fixture stamped remind30At", !!db.fixtures[1].notify.remind30At);

console.log("Run 2 (dedupe, same time):");
const r2 = runDueNotifications(db, now);
check("no duplicate emails on second pass", r2.outbox.length === 0);
check("db not changed on second pass", r2.changed === false);

console.log("Run 3 (F3 now within 30 min):");
const r3 = runDueNotifications(db, new Date(now.getTime() + 65 * 60000)); // 90 - 65 = 25 min to F3
check("F3 now sends 2 reminders as it enters the window", r3.outbox.filter((m) => m.fixtureId === 3 && m.type === "reminder").length === 2);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll notification engine checks passed.");
