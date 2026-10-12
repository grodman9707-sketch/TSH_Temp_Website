// Current week stays open; earlier weeks are chosen from a menu.
// Run: `node server/fixture-weeks.test.js`
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fixtureWeekGroups, fixtureWeekTitle, previousFixtureWeeks, selectFixtureWeek } from "../public/fixtureWeeks.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const now = new Date("2026-10-12T12:00:00Z");
const fixtures = [
  { id: 1, season: 1, week: 1, weekStart: "2026-09-27", date: "2026-09-28", homeName: "A", awayName: "B" },
  { id: 2, season: 1, week: 1, weekStart: "2026-09-27", date: "2026-09-27", homeName: "C", awayName: "D" },
  { id: 3, season: 1, week: 2, weekStart: "2026-10-04", date: "2026-10-04", homeName: "A", awayName: "C" },
  { id: 4, season: 1, week: 3, weekStart: "2026-10-11", date: "2026-10-11", homeName: "B", awayName: "D" },
];
const groups = fixtureWeekGroups(fixtures);
const view = selectFixtureWeek(groups, "", now);
check("three released weeks group together", groups.length === 3 && groups[0].fixtures.length === 2);
check("current week is the latest one that has started", view.current?.week === 3 && view.shown?.week === 3 && !view.picked);
check(
  "earlier weeks are listed newest first",
  view.previous.map((group) => group.week).join(",") === "2,1"
);
check("week title includes the Sunday date", fixtureWeekTitle(view.current) === "Week 3 · 11 Oct 2026");

const older = selectFixtureWeek(groups, "1", now);
check("choosing a previous week shows only that week", older.picked?.week === 1 && older.shown?.fixtures.length === 2 && older.shown.fixtures.every((f) => f.week === 1));
const unknown = selectFixtureWeek(groups, "9", now);
check("an unknown week falls back to the current week", !unknown.picked && unknown.shown?.week === 3);

const only = fixtureWeekGroups([{ id: 8, season: 1, week: 1, weekStart: "2026-10-11", date: "2026-10-11" }]);
const alone = selectFixtureWeek(only, "", now);
check("a lone current week has no previous-week menu", alone.current?.week === 1 && alone.menu.length === 0 && previousFixtureWeeks(only, alone.current).length === 0);

const beforeDrop = new Date("2026-10-10T12:00:00Z");
const waiting = selectFixtureWeek(groups, "", beforeDrop);
check("a week that has not started yet is not the default", waiting.current?.week === 2 && waiting.menu.some((group) => group.week === 3));

const seasons = fixtureWeekGroups([
  { id: 1, season: 1, week: 4, weekStart: "2026-10-04" },
  { id: 2, season: 2, week: 1, weekStart: "2026-10-11" },
]);
const seasonView = selectFixtureWeek(seasons, "", now);
check("a new season becomes the current week", seasonView.current?.key === "2-1" && seasonView.previous[0]?.key === "4");
check("season title names the season", fixtureWeekTitle(seasonView.current) === "Season 2 · Week 1 · 11 Oct 2026");

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
check(
  "fixtures tab defaults to the current week and offers earlier weeks",
  appJs.includes("selectFixtureWeek") &&
    appJs.includes('data-act="fixture-week"') &&
    appJs.includes("PREVIOUS WEEKS") &&
    appJs.includes("CURRENT WEEK")
);
check("previous-week menu wraps on a narrow screen", css.includes(".fixture-week-bar") && css.includes("flex-wrap: wrap") && css.includes(".fixture-week-select"));

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("fixture week tests passed");
