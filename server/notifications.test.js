// Unit tests for the match-notification engine. Run: `node server/notifications.test.js`
// Uses the console dev-fallback (no EMAIL_API_KEY), so nothing is actually sent.
import { matchChatDeliveries, runDueNotifications } from "./notifications.js";

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
    { id: 5, leagueId: 1, week: 3, homeId: 7, awayId: 8, status: "scheduled", scheduleStatus: null, date: in2days, time: "", notify: { ...noNew } },
    // F6: match next month -> outside the 7-day window, nothing.
    { id: 6, leagueId: 1, week: 8, homeId: 1, awayId: 5, status: "scheduled", scheduleStatus: null, date: nextMonth, time: "", notify: { ...noNew } },
    // F7: brand-new fixture in the current week -> "scheduled" alert to both.
    { id: 7, leagueId: 1, week: 3, homeId: 1, awayId: 2, status: "scheduled", scheduleStatus: null, date: in2days, weekStart: in2days, notify: { newHomeAt: null, newAwayAt: null, weekHomeAt: "seen", weekAwayAt: "seen", remind30At: null } },
    // F8: unreleased future week -> no emails until that Sunday 00:00 GMT.
    { id: 8, leagueId: 1, week: 9, homeId: 1, awayId: 2, status: "scheduled", scheduleStatus: null, date: nextMonth, weekStart: nextMonth, notify: { newHomeAt: null, newAwayAt: null, weekHomeAt: null, weekAwayAt: null, remind30At: null } },
  ],
};

console.log("Run 1 (first pass):");
const r1 = runDueNotifications(db, now);
const weekly = r1.outbox.filter((m) => m.type === "weekly");
const reminders = r1.outbox.filter((m) => m.type === "reminder");

const scheduled = r1.outbox.filter((m) => m.type === "new_match");
check("brand-new fixture sends a 'scheduled' alert to both players", scheduled.filter((m) => m.fixtureId === 7).length === 2);
check("unreleased future week does not send a scheduled alert", scheduled.filter((m) => m.fixtureId === 8).length === 0);
check("unreleased future week does not stamp notify markers", !db.fixtures[7].notify.newHomeAt && !db.fixtures[7].notify.newAwayAt);
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

console.log("Channels (email, SMS, push) share one stamp:");
const channelNow = new Date("2026-08-20T12:00:00Z");
const kickoff = new Date(channelNow.getTime() + 20 * 60000);
const sub = {
  endpoint: "https://push.example.test/sub/1",
  keys: { p256dh: "p256", auth: "auth" },
  createdAt: "2026-08-01T00:00:00.000Z",
};
const verified = "2026-08-01T00:00:00.000Z";
const channelDb = {
  leagues: [{ id: 1, name: "League 1" }],
  users: [
    { id: 1, name: "All", email: "all@x.com", timezone: "America/New_York", phone: "+447911123456", phoneVerifiedAt: verified, notifyPrefs: { email: true, sms: true, push: true }, pushSubscriptions: [sub] },
    { id: 2, name: "SmsOnly", email: "sms@x.com", phone: "+447911123457", phoneVerifiedAt: verified, notifyPrefs: { email: false, sms: true, push: false }, pushSubscriptions: [sub] },
    { id: 3, name: "Unverified", email: "uv@x.com", phone: "+447911123458", phoneVerifiedAt: null, notifyPrefs: { email: false, sms: true, push: false } },
    { id: 4, name: "PushOff", email: "poff@x.com", notifyPrefs: { email: false, sms: false, push: false }, pushSubscriptions: [sub] },
  ],
  fixtures: [
    { id: 21, leagueId: 1, week: 4, homeId: 1, awayId: 2, status: "scheduled", date: "2026-10-01", weekStart: "2026-08-16", notify: { newHomeAt: null, newAwayAt: null, weekHomeAt: "seen", weekAwayAt: "seen", remind30At: "seen" } },
    { id: 22, leagueId: 1, week: 4, homeId: 3, awayId: 4, status: "scheduled", date: "2026-10-01", weekStart: "2026-08-16", notify: { newHomeAt: null, newAwayAt: null, weekHomeAt: "seen", weekAwayAt: "seen", remind30At: "seen" } },
    { id: 23, leagueId: 1, week: 4, homeId: 1, awayId: 2, status: "scheduled", scheduleStatus: "agreed", startAt: kickoff.toISOString(), date: "2026-08-20", time: "13:00", notify: { newHomeAt: "seen", newAwayAt: "seen", weekHomeAt: "seen", weekAwayAt: "seen", remind30At: null } },
  ],
};
const channels = runDueNotifications(channelDb, channelNow);
const f21 = channels.outbox.filter((m) => m.fixtureId === 21);
check("verified player with every channel gets email, SMS, and push for one new match", f21.filter((m) => m.userId === 1 && m.channel === "email").length === 1 && f21.filter((m) => m.userId === 1 && m.channel === "sms").length === 1 && f21.filter((m) => m.userId === 1 && m.channel === "push").length === 1);
check("email-off SMS-on player gets SMS only", f21.filter((m) => m.userId === 2).length === 1 && f21.some((m) => m.userId === 2 && m.channel === "sms" && m.to === "+447911123457"));
check("new-match SMS names the opponent and points at My Matches", f21.some((m) => m.userId === 2 && m.channel === "sms" && m.body.includes("All") && m.body.includes("League 1") && m.body.includes("Week 4") && m.body.includes("My Matches") && m.body.length <= 300));
check("push payload has a title, body, and url", f21.some((m) => m.userId === 1 && m.channel === "push" && m.payload.title && m.payload.body.includes("SmsOnly") && m.payload.url === "/my-matches"));
const f22 = channels.outbox.filter((m) => m.fixtureId === 22);
check("unverified phone gets no SMS", f22.every((m) => m.channel !== "sms") && !f22.some((m) => m.userId === 3));
check("push turned off gets no push even with a saved subscription", !f22.some((m) => m.channel === "push" || m.userId === 4));
check("one event stamps both players even when a channel is skipped", channelDb.fixtures[0].notify.newHomeAt && channelDb.fixtures[0].notify.newAwayAt && channelDb.fixtures[1].notify.newHomeAt && channelDb.fixtures[1].notify.newAwayAt);
const again = runDueNotifications(channelDb, channelNow);
check("dedupe markers block a second send on every channel", again.outbox.length === 0 && again.changed === false);
const channelReminders = channels.outbox.filter((m) => m.fixtureId === 23);
const homeReminder = channelReminders.find((m) => m.userId === 1 && m.channel === "email");
const homeSms = channelReminders.find((m) => m.userId === 1 && m.channel === "sms");
const localWhen = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(kickoff);
check("reminder SMS uses the recipient timezone, same label as the email", Boolean(homeReminder?.when) && homeReminder.when === localWhen && homeSms?.body.includes(localWhen));
check("reminder still reaches the SMS-only opponent", channelReminders.some((m) => m.userId === 2 && m.channel === "sms") && !channelReminders.some((m) => m.userId === 2 && m.channel === "email"));
check("second reminder pass does not send again", again.outbox.filter((m) => m.fixtureId === 23).length === 0);

const chatUser = { id: 9, name: "Pat", email: "pat@x.com", phone: "+447911123456", phoneVerifiedAt: verified, notifyPrefs: { email: false, sms: true, push: true }, pushSubscriptions: [sub] };
const chat = matchChatDeliveries(chatUser, { name: "Sam" }, { id: 9, week: 2 }, "League 1", "Tuesday at 8?");
check("arrange chat with email off still builds SMS and push", chat.length === 2 && chat.some((m) => m.channel === "sms" && m.body.includes("Sam") && m.body.includes("Tuesday at 8?")) && chat.some((m) => m.channel === "push" && m.payload.url === "/my-matches?fixture=9"));
const quiet = matchChatDeliveries({ id: 10, name: "Quiet", email: "q@x.com", notifyPrefs: { email: false, sms: false, push: false } }, { name: "Sam" }, { id: 9, week: 2 }, "League 1", "Hi");
check("arrange chat with every channel off queues nothing", quiet.length === 0);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll notification engine checks passed.");
