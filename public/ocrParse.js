// DartCounter screenshot text → match stats.
// Used by the browser OCR path and by Node tests (ESM).

export const EXTRACT_STAT_FIELDS = [
  "homeLegs",
  "awayLegs",
  "homeAvg",
  "awayAvg",
  "homeCheckout",
  "awayCheckout",
  "homeBestLeg",
  "awayBestLeg",
  "topCheckout",
  "home60",
  "away60",
  "home80",
  "away80",
  "home100",
  "away100",
  "home120",
  "away120",
  "home140",
  "away140",
  "home160",
  "away160",
  "home180",
  "away180",
  "homeOneEighties",
  "awayOneEighties",
];

const STAT_KEYS = ["Legs", "Avg", "Checkout", "BestLeg", "60", "80", "100", "120", "140", "160", "180"];

const LABEL_SPECS = [
  { key: "Avg", re: /3[\s-]?d(?:art)?s?\s*a(?:vg|verage)?|\b3da\b|match\s*avg(?:erage)?|(?<!first\s*9\s*)(?<!first\s*nine\s*)\baverages?\b|\bavg\b/i },
  { key: "Checkout", re: /highest\s*(?:co|c\/o|checkout)|hi(?:gh(?:est)?)?\s*(?:co|c\/o|checkout)|high(?:est)?\s*finish/i },
  { key: "BestLeg", re: /best\s*leg|fewest\s*darts|best\s*leg\s*\(darts\)/i },
  { key: "180", re: /180['’]?s?\b|one\s*eight(?:y|ies)/i },
  { key: "160", re: /160\s*\+/i },
  { key: "140", re: /140\s*\+/i },
  { key: "120", re: /120\s*\+/i },
  { key: "100", re: /100\s*\+/i },
  { key: "80", re: /80\s*\+/i },
  { key: "60", re: /60\s*\+/i },
];

function aliasesFor(name, extraNames = []) {
  return [name, ...extraNames].map((n) => String(n || "").trim()).filter(Boolean);
}

export function nameHits(text, name) {
  if (!name) return 0;
  const t = String(text).toLowerCase();
  const n = String(name).toLowerCase().trim();
  if (!n) return 0;
  if (t.includes(n)) return 3;
  return n.split(/\s+/).filter((p) => p.length > 2 && t.includes(p)).length;
}

function nameHitsAny(text, names) {
  return aliasesFor(null, names).reduce((best, n) => Math.max(best, nameHits(text, n)), 0);
}

function toNum(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function firstNum(text, re) {
  const m = String(text).match(re);
  return m ? toNum(m[1]) : null;
}

function nextNumbers(str, count = 2) {
  const nums = [];
  const re = /(\d{1,3}(?:[.,]\d{1,2})?)/g;
  let m;
  while (nums.length < count && (m = re.exec(String(str || "")))) {
    const n = toNum(m[1]);
    if (n == null) continue;
    nums.push(n);
  }
  return nums;
}

function numbersOnNextValueLine(after) {
  const lines = String(after || "")
    .split(/\n/)
    .map((l) => l.trim());
  // Remainder of the label's own line, otherwise the next non-empty line.
  const sameLine = lines[0] || "";
  if (nextNumbers(sameLine, 1).length) return nextNumbers(sameLine, 2);
  const next = lines.find((l, i) => i > 0 && l);
  return next ? nextNumbers(next, 2) : [];
}

export function parsePlayerBlock(text) {
  const t = String(text);
  return {
    Legs: firstNum(t, /(?:legs?\s*won|leg\s*score|\bscore)\s*[:.]?\s*(\d{1,2})/i),
    Avg: firstNum(t, /(?:3[\s-]?d(?:art)?s?\s*a(?:vg|verage)?|3da|match\s*avg(?:erage)?)\s*[:.]?\s*(\d{1,3}(?:[.,]\d{1,2})?)/i),
    Checkout: firstNum(t, /(?:highest\s*)?(?:co|c\/o|checkout|check\s*out|high(?:est)?\s*finish)\s*[:.]?\s*(\d{1,3})/i),
    BestLeg: firstNum(t, /(?:best\s*leg|fewest\s*darts)\s*[:.]?\s*(\d{1,3})/i),
    60: firstNum(t, /(?:60\+|60\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    80: firstNum(t, /(?:80\+|80\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    100: firstNum(t, /(?:100\+|100\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    120: firstNum(t, /(?:120\+|120\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    140: firstNum(t, /(?:140\+|140\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    160: firstNum(t, /(?:160\+|160\s*\+)\s*[:.]?\s*(\d{1,3})/i),
    180: firstNum(t, /(?:180['’]?s?|one\s*eight(?:y|ies))\s*[:.]?\s*(\d{1,3})/i),
  };
}

function numbersAroundLabel(raw, matchIndex, matchLen) {
  const after = raw.slice(matchIndex + matchLen, matchIndex + matchLen + 100);
  const afterNums = numbersOnNextValueLine(after);
  if (afterNums.length >= 2) return afterNums;
  const beforeLine = (raw.slice(Math.max(0, matchIndex - 80), matchIndex).split(/\n/).pop() || "").trim();
  const beforeNums = nextNumbers(beforeLine, 2);
  if (beforeNums.length && afterNums.length) return [beforeNums[beforeNums.length - 1], afterNums[0]];
  if (afterNums.length) return afterNums;
  return beforeNums;
}

function applyLabelPairs(text, stats, homeFirst) {
  const raw = String(text || "");
  for (const spec of LABEL_SPECS) {
    const re = new RegExp(spec.re.source, spec.re.flags.includes("g") ? spec.re.flags : `${spec.re.flags}g`);
    let m;
    while ((m = re.exec(raw))) {
      const nums = numbersAroundLabel(raw, m.index, m[0].length);
      if (!nums.length) continue;
      if (spec.key === "Avg") {
        const usable = nums.filter((n) => n >= 20 && n <= 140);
        if (!usable.length) continue;
        const a = usable[0];
        const b = usable[1];
        if (stats.homeAvg == null) stats.homeAvg = homeFirst ? a : b ?? a;
        if (b != null && stats.awayAvg == null) stats.awayAvg = homeFirst ? b : a;
        continue;
      }
      if (spec.key === "40") continue;
      const a = nums[0];
      const b = nums[1];
      const homeKey = `home${spec.key}`;
      const awayKey = `away${spec.key}`;
      if (stats[homeKey] == null) stats[homeKey] = homeFirst || b == null ? a : b;
      if (b != null && stats[awayKey] == null) stats[awayKey] = homeFirst ? b : a;
    }
  }
}

function parseScore(raw, homeNames, awayNames) {
  const score = String(raw).match(/\b([0-5])\s*[-–:]\s*([0-5])\b/);
  if (!score) return null;
  const a = Number(score[1]);
  const b = Number(score[2]);
  if (!((a === 5) !== (b === 5)) && !(a === 5 || b === 5)) {
    // Best of 9 must have a winner to 5, but still capture a plausible score.
  }
  const before = raw.slice(0, score.index).toLowerCase();
  const homeFirst = nameHitsAny(before, homeNames) >= nameHitsAny(before, awayNames);
  return {
    homeLegs: homeFirst ? a : b,
    awayLegs: homeFirst ? b : a,
  };
}

export function parseDartCounterText(text, homeName, awayName, extra = {}) {
  const raw = String(text || "").replace(/\u00a0/g, " ");
  const homeNames = aliasesFor(homeName, [extra.homeDartcounterName, extra.homeNickname]);
  const awayNames = aliasesFor(awayName, [extra.awayDartcounterName, extra.awayNickname]);
  const stats = {};

  const score = parseScore(raw, homeNames, awayNames);
  if (score) {
    stats.homeLegs = score.homeLegs;
    stats.awayLegs = score.awayLegs;
  }

  const mid = Math.floor(raw.length / 2);
  const homeIdx = Math.min(
    ...homeNames.map((n) => raw.toLowerCase().indexOf(n.toLowerCase())).filter((i) => i >= 0),
    Infinity
  );
  const awayIdx = Math.min(
    ...awayNames.map((n) => raw.toLowerCase().indexOf(n.toLowerCase())).filter((i) => i >= 0),
    Infinity
  );
  let homeBlock = raw.slice(0, mid);
  let awayBlock = raw.slice(mid);
  let homeFirst = true;
  if (Number.isFinite(homeIdx) && Number.isFinite(awayIdx) && homeIdx !== awayIdx) {
    homeFirst = homeIdx < awayIdx;
    if (homeFirst) {
      homeBlock = raw.slice(homeIdx, awayIdx);
      awayBlock = raw.slice(awayIdx);
    } else {
      awayBlock = raw.slice(awayIdx, homeIdx);
      homeBlock = raw.slice(homeIdx);
    }
  } else if (nameHitsAny(raw.slice(0, mid), awayNames) > nameHitsAny(raw.slice(0, mid), homeNames)) {
    homeFirst = false;
    homeBlock = raw.slice(mid);
    awayBlock = raw.slice(0, mid);
  }

  applyLabelPairs(raw, stats, homeFirst);

  const home = parsePlayerBlock(homeBlock);
  const away = parsePlayerBlock(awayBlock);
  const both = parsePlayerBlock(raw);
  const assign = (side, parsed, fallback) => {
    for (const [key, val] of Object.entries(parsed)) {
      const field = `${side}${key}`;
      const v = val != null ? val : fallback[key];
      if (v == null || Number.isNaN(v)) continue;
      if (stats[field] == null) stats[field] = v;
    }
  };
  assign("home", home, both);
  assign("away", away, both);
  if (stats.home180 != null) stats.homeOneEighties = stats.home180;
  if (stats.away180 != null) stats.awayOneEighties = stats.away180;
  if (stats.homeCheckout != null || stats.awayCheckout != null) {
    stats.topCheckout = Math.max(stats.homeCheckout || 0, stats.awayCheckout || 0);
  }
  stats.rawText = raw.slice(0, 2500);
  return stats;
}

function assignSideFromBlock(out, side, block, overwrite = false) {
  for (const key of STAT_KEYS) {
    const field = `${side}${key}`;
    if (block[key] == null || Number.isNaN(block[key])) continue;
    if (overwrite || out[field] == null) out[field] = block[key];
  }
}

export function mergeOcrStats(texts, homeName, awayName, extra = {}) {
  const chunks = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || "")).filter((t) => t.trim());
  const combined = parseDartCounterText(chunks.join("\n\n"), homeName, awayName, extra);
  const out = { ...combined };
  const homeNames = aliasesFor(homeName, [extra.homeDartcounterName, extra.homeNickname]);
  const awayNames = aliasesFor(awayName, [extra.awayDartcounterName, extra.awayNickname]);

  for (const chunk of chunks) {
    const homeScore = nameHitsAny(chunk, homeNames);
    const awayScore = nameHitsAny(chunk, awayNames);
    const parsed = parseDartCounterText(chunk, homeName, awayName, extra);
    const block = parsePlayerBlock(chunk);
    if (homeScore > awayScore) {
      assignSideFromBlock(out, "home", block, true);
      if (parsed.homeLegs != null) out.homeLegs = parsed.homeLegs;
      if (parsed.awayLegs != null && out.awayLegs == null) out.awayLegs = parsed.awayLegs;
      for (const key of STAT_KEYS) {
        const field = `home${key}`;
        if (parsed[field] != null) out[field] = parsed[field];
      }
    } else if (awayScore > homeScore) {
      assignSideFromBlock(out, "away", block, true);
      if (parsed.awayLegs != null) out.awayLegs = parsed.awayLegs;
      if (parsed.homeLegs != null && out.homeLegs == null) out.homeLegs = parsed.homeLegs;
      for (const key of STAT_KEYS) {
        const field = `away${key}`;
        if (parsed[field] != null) out[field] = parsed[field];
      }
    }
  }

  if (out.home180 != null) out.homeOneEighties = out.home180;
  if (out.away180 != null) out.awayOneEighties = out.away180;
  if (out.homeCheckout != null || out.awayCheckout != null) {
    out.topCheckout = Math.max(out.homeCheckout || 0, out.awayCheckout || 0);
  }
  return out;
}

export function hasNumericExtracted(extracted) {
  if (!extracted || typeof extracted !== "object") return false;
  return EXTRACT_STAT_FIELDS.some((key) => {
    const v = extracted[key];
    return v !== undefined && v !== null && v !== "";
  });
}

export function overlayExtractedStats(fixture) {
  if (!fixture || fixture.status === "played") return fixture;
  const extracted = fixture.extractedStats;
  if (!hasNumericExtracted(extracted)) return fixture;
  const out = { ...fixture };
  for (const key of EXTRACT_STAT_FIELDS) {
    if (extracted[key] !== undefined && extracted[key] !== null && extracted[key] !== "") {
      out[key] = extracted[key];
    }
  }
  return out;
}
