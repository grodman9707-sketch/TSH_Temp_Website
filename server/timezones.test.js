// Tests for timezone conversion + startAt-driven reminders.
// Run: `node server/timezones.test.js`
import { wallStringToUtc, isValidTimeZone, defaultTimezoneForRegional } from "./timezones.js";
import { runDueNotifications } from "./notifications.js";

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

// --- wall time -> absolute instant, per zone (DST-aware) ---
check(
  "London 20:00 in August (BST, UTC+1) = 19:00Z",
  wallStringToUtc("2026-08-21", "20:00", "Europe/London").toISOString() === "2026-08-21T19:00:00.000Z"
);
check(
  "London 20:00 in January (GMT, UTC+0) = 20:00Z",
  wallStringToUtc("2026-01-21", "20:00", "Europe/London").toISOString() === "2026-01-21T20:00:00.000Z"
);
check(
  "New York 20:00 in August (EDT, UTC-4) = 00:00Z next day",
  wallStringToUtc("2026-08-21", "20:00", "America/New_York").toISOString() === "2026-08-22T00:00:00.000Z"
);

// The same UK 20:00 kickoff is a single instant that a US player sees as 15:00.
const instant = wallStringToUtc("2026-08-21", "20:00", "Europe/London");
const nyLocal = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(instant);
check("UK 20:00 shows as 15:00 in New York", nyLocal === "15:00");

check("isValidTimeZone accepts a real zone", isValidTimeZone("America/Los_Angeles") === true);
check("isValidTimeZone rejects junk", isValidTimeZone("Not/AZone") === false);
check("defaultTimezoneForRegional maps americas -> New York", defaultTimezoneForRegional("americas") === "America/New_York");
check("defaultTimezoneForRegional maps europe -> London", defaultTimezoneForRegional("europe") === "Europe/London");

// --- reminder uses the absolute startAt regardless of naive date/time ---
const now = new Date("2026-08-20T12:00:00Z");
const db = {
  leagues: [{ id: 1, name: "League 1" }],
  users: [
    { id: 1, name: "UK", email: "uk@x.com", timezone: "Europe/London", notifyPrefs: { email: true } },
    { id: 2, name: "US", email: "us@x.com", timezone: "America/Los_Angeles", notifyPrefs: { email: true } },
  ],
  fixtures: [
    {
      id: 1,
      leagueId: 1,
      week: 3,
      homeId: 1,
      awayId: 2,
      status: "scheduled",
      scheduleStatus: "agreed",
      date: "2026-08-20",
      time: "13:00",
      startAt: new Date(now.getTime() + 25 * 60000).toISOString(), // 25 min from now
      notify: { weekHomeAt: "seen", weekAwayAt: "seen", remind30At: null },
    },
  ],
};
const r = runDueNotifications(db, now);
check("startAt within 30 min fires a reminder to both players", r.outbox.filter((m) => m.type === "reminder").length === 2);
check("reminder marker stamped", !!db.fixtures[0].notify.remind30At);
const r2 = runDueNotifications(db, now);
check("no duplicate reminder on second pass", r2.outbox.length === 0);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll timezone checks passed.");
