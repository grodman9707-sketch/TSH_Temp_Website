// Tests for DartCounter screenshot text parsing.
// Run: `node server/ocrParse.test.js`
import { hasNumericExtracted, mergeOcrStats, overlayExtractedStats, parseDartCounterText } from "../public/ocrParse.js";

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const twoCol = `
Alex Player                 Morgan Player
5 - 3
3 Dart Average
62.45          51.20
Highest Checkout
140            85
Best Leg
15             18
180s
2              0
140+
4              2
100+
9              6
80+
12             10
60+
18             15
`;

const parsed = parseDartCounterText(twoCol, "Alex Player", "Morgan Player");
check("two-column score is 5-3", parsed.homeLegs === 5 && parsed.awayLegs === 3);
check("two-column 3DA", parsed.homeAvg === 62.45 && parsed.awayAvg === 51.2);
check("two-column checkout", parsed.homeCheckout === 140 && parsed.awayCheckout === 85);
check("two-column best leg", parsed.homeBestLeg === 15 && parsed.awayBestLeg === 18);
check("two-column 180s", parsed.home180 === 2 && parsed.away180 === 0);
check("two-column 140+", parsed.home140 === 4 && parsed.away140 === 2);
check("hasNumericExtracted on parse", hasNumericExtracted(parsed) === true);

const homeOnly = `
Alex Player
3 Dart Average 58.1
Highest Checkout 121
180s 1
Legs won 5
`;
const awayOnly = `
Morgan Player
3 Dart Average 49.4
Highest Checkout 80
180s 0
score 3
`;
const merged = mergeOcrStats([homeOnly, awayOnly], "Alex Player", "Morgan Player");
check("merge assigns home 3DA from home screenshot", merged.homeAvg === 58.1);
check("merge assigns away 3DA from away screenshot", merged.awayAvg === 49.4);
check("merge 180s per player", merged.home180 === 1 && merged.away180 === 0);

const dartcounterAlias = parseDartCounterText(
  `GViking vs TheMachine\n5-2\n3DA 70.1 55.5`,
  "Gordon Rodman",
  "Alex Player",
  { homeDartcounterName: "GViking", awayDartcounterName: "TheMachine" }
);
check("uses DartCounter display names for left/right", dartcounterAlias.homeAvg === 70.1 && dartcounterAlias.awayAvg === 55.5);

const matchAvg = parseDartCounterText(
  `Alex Player  Morgan Player\n5-3\nMatch average\n62.45 51.20\n180's\n2 0`,
  "Alex Player",
  "Morgan Player"
);
check("Match average label is 3DA", matchAvg.homeAvg === 62.45 && matchAvg.awayAvg === 51.2);
check("180's with apostrophe", matchAvg.home180 === 2 && matchAvg.away180 === 0);

const splitLayout = parseDartCounterText(
  `Alex Player                    Morgan Player\n62.45  Match average  51.20\n140  Highest Checkout  85`,
  "Alex Player",
  "Morgan Player"
);
check("values on both sides of Match average", splitLayout.homeAvg === 62.45 && splitLayout.awayAvg === 51.2);
check("values on both sides of Highest Checkout", splitLayout.homeCheckout === 140 && splitLayout.awayCheckout === 85);

const overlay = overlayExtractedStats({
  status: "submitted",
  homeLegs: null,
  awayLegs: null,
  extractedStats: { homeLegs: 5, awayLegs: 2, homeAvg: 61.2, pending: true },
});
check("overlay copies extracted legs onto admin fields", overlay.homeLegs === 5 && overlay.awayLegs === 2 && overlay.homeAvg === 61.2);
check("overlay skips played fixtures", overlayExtractedStats({ status: "played", homeLegs: 5, extractedStats: { homeLegs: 1 } }).homeLegs === 5);
check("empty extracted is not numeric", hasNumericExtracted({ pending: true, rawText: "hi", extractedAt: "x" }) === false);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll ocr parse checks passed.");
