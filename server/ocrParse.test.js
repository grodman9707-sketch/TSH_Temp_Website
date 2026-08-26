// Tests for DartCounter screenshot text parsing.
// Run: `node server/ocrParse.test.js`
import { hasNumericExtracted, mergeOcrStats, overlayExtractedStats, parseDartCounterText, pickBestOcrText, scoreOcrCandidate, shouldInvertLuma } from "../public/ocrParse.js";

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

const matchDetails = `
MATCH DETAILS
BEST OF 9 LEGS - 501
Gordon                    Jason
1                         5
43.21  3-dart average  46.28
52.67  First 9 avg.  63.78
50.00%  Checkout rate  11.36%
1/2  Checkouts  5/44
16  Highest finish  60
121  Highest score  180
32 DARTS  Best leg  22 DARTS
32 DARTS  Worst leg  54 DARTS
0  180  1
0  160+  0
0  140+  1
1  120+  1
1  100+  3
7  80+  8
7  60+  8
17  40+  18
`;
const details = parseDartCounterText(matchDetails, "Gordon Rodman", "Jay Jay", {
  homeDartcounterName: "Gordon Rodman",
  awayDartcounterName: "Jason jackson",
  homeNickname: "Viking",
  awayNickname: "JJ",
});
check("MATCH DETAILS score 1-5", details.homeLegs === 1 && details.awayLegs === 5);
check("MATCH DETAILS 3-dart average, not First 9", details.homeAvg === 43.21 && details.awayAvg === 46.28);
check("MATCH DETAILS highest finish is checkout", details.homeCheckout === 16 && details.awayCheckout === 60);
check("MATCH DETAILS best leg darts", details.homeBestLeg === 32 && details.awayBestLeg === 22);
check("MATCH DETAILS 180 count not highest score", details.home180 === 0 && details.away180 === 1);
check("MATCH DETAILS 140+", details.home140 === 0 && details.away140 === 1);
check("MATCH DETAILS 100+", details.home100 === 1 && details.away100 === 3);
check("MATCH DETAILS 80+", details.home80 === 7 && details.away80 === 8);
check("MATCH DETAILS 60+", details.home60 === 7 && details.away60 === 8);
check("MATCH DETAILS ignores 40+", details.home40 == null && details.away40 == null);

const messyOcr = `
MATCH DETAILS
Gordon Jason
43.21 46.28
5267 6378
50.00% 11.36%
16 60
121 180
32 DARTS 22 DARTS
32 DARTS 54 DARTS
0 1
0 0
0 1
1 1
1 3
] 8
] 8
17 18
`;
const messy = parseDartCounterText(messyOcr, "Gordon Rodman", "Jay Jay", {
  homeDartcounterName: "Gordon Rodman",
  awayDartcounterName: "Jason jackson",
});
check("messy OCR 3DA from first decimal pair", messy.homeAvg === 43.21 && messy.awayAvg === 46.28);
check("messy OCR compact 5267 is First 9 not 3DA", messy.homeAvg === 43.21);
check("messy OCR highest finish", messy.homeCheckout === 16 && messy.awayCheckout === 60);
check("messy OCR best leg", messy.homeBestLeg === 32 && messy.awayBestLeg === 22);
check("messy OCR 180s from page-2 run", messy.home180 === 0 && messy.away180 === 1);
check("messy OCR ] reads as 7 for 80+", messy.home80 === 7 && messy.away80 === 8);
check("messy OCR 60+", messy.home60 === 7 && messy.away60 === 8);
check("messy OCR 100+", messy.home100 === 1 && messy.away100 === 3);

const headerScore = parseDartCounterText(
  `MATCH DETAILS\nGordon Jason\n1] 5\n43.21 46.28`,
  "Gordon Rodman",
  "Jay Jay",
  { awayDartcounterName: "Jason jackson" }
);
check("header score box 1] 5", headerScore.homeLegs === 1 && headerScore.awayLegs === 5);

const checkoutsAsLegs = parseDartCounterText(
  `Gordon Jason\n43.21 46.28\n1/2  Checkouts  5/44\n16 60`,
  "Gordon Rodman",
  "Jay Jay",
  { awayDartcounterName: "Jason jackson" }
);
check("501 checkouts made fill legs when score is missing", checkoutsAsLegs.homeLegs === 1 && checkoutsAsLegs.awayLegs === 5);

const liveOcr = `
STRAIGHT IN | DOUBLE OUT
ys ms) 5 S2(9
43.21 46.28
52.67 63.78
50.00% Thd6%
1/2 5/44
16 G0
121 180
32 DARTS 22 DARTS
32 DARTS 54 DARTS
0 I
0 0
0 I
I I
I 3
] B
] B
1 18
`;
const live = parseDartCounterText(liveOcr, "Gordon Rodman", "Jay Jay", {
  homeDartcounterName: "Gordon Rodman",
  awayDartcounterName: "Jason jackson",
});
check("live OCR does not treat 5 S2 as the score", !(live.homeLegs === 5 && live.awayLegs === 2));
check("live OCR legs from checkouts 1/2 5/44", live.homeLegs === 1 && live.awayLegs === 5);
check("live OCR 3DA", live.homeAvg === 43.21 && live.awayAvg === 46.28);
check("live OCR G0 is 60 checkout", live.homeCheckout === 16 && live.awayCheckout === 60);
check("live OCR best leg not 180s", live.homeBestLeg === 32 && live.awayBestLeg === 22 && live.home180 === 0 && live.away180 === 1);
check("live OCR I/] /B page-2 bands", live.home100 === 1 && live.away100 === 3 && live.home80 === 7 && live.away80 === 8 && live.home60 === 7 && live.away60 === 8);
check("live OCR 140+", live.home140 === 0 && live.away140 === 1);

const page1Only = `
MATCH DETAILS
Gordon                    Jason
1                         5
43.21  3-dart average  46.28
52.67  First 9 avg.  63.78
16  Highest finish  60
121  Highest score  180
32 DARTS  Best leg  22 DARTS
`;
const page1 = parseDartCounterText(page1Only, "Gordon Rodman", "Jay Jay", {
  homeDartcounterName: "Gordon Rodman",
  awayDartcounterName: "Jason jackson",
});
check("page 1 3DA is not First 9", page1.homeAvg === 43.21 && page1.awayAvg === 46.28);
check("page 1 highest finish not highest score", page1.homeCheckout === 16 && page1.awayCheckout === 60);
check("page 1 does not treat 180 high score as 180s", page1.home180 == null && page1.away180 == null);

const homeShotOnly = parseDartCounterText(
  `Gordon Rodman\n3 Dart Average 58.1\nHighest Checkout 121\n180s 1`,
  "Gordon Rodman",
  "Morgan Player"
);
check("one-player shot does not copy home numbers onto away", homeShotOnly.awayAvg == null && homeShotOnly.awayCheckout == null && homeShotOnly.away180 == null);
check("one-player shot still fills home", homeShotOnly.homeAvg === 58.1 && homeShotOnly.homeCheckout === 121 && homeShotOnly.home180 === 1);

check("dark screenshots should invert", shouldInvertLuma(42) === true);
check("light screenshots should not invert", shouldInvertLuma(210) === false);

const goodRead = "MATCH DETAILS\nGordon Jason\n43.21  3-dart average  46.28\n16 Highest finish 60";
const invertedGarbage = "8 $ # 91 180 52 7 3 14 221";
check("labeled DartCounter text outranks inverted garbage", pickBestOcrText([
  { text: invertedGarbage, confidence: 70 },
  { text: goodRead, confidence: 55 },
]).includes("3-dart average"));
check("empty OCR candidate scores below usable text", scoreOcrCandidate("") < scoreOcrCandidate(goodRead));

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll ocr parse checks passed.");
