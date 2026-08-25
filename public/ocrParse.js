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

// DartCounter MATCH DETAILS: grey pill label in the centre, home value on the
// left, away value on the right. Page 1 is averages/finish; page 2 is scoring bands.
const PAGE2_BANDS = ["180", "160", "140", "120", "100", "80", "60"];

const LABEL_SPECS = [
  { key: "Avg", re: /3[\s-]?darts?\s*avg(?:erage|\.)?|\b3da\b|match\s*avg(?:erage)?/i },
  { key: "Checkout", re: /highest\s*finish|highest\s*(?:co|c\/o|checkout)|hi(?:gh(?:est)?)?\s*(?:co|c\/o|checkout)/i },
  { key: "BestLeg", re: /best\s*leg|fewest\s*darts/i },
  { key: "180", re: /180['’]?s\b|one\s*eight(?:y|ies)/i },
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
    180: firstNum(t, /(?:180['’]?s|one\s*eight(?:y|ies))\s*[:.]?\s*(\d{1,3})/i),
  };
}

function numbersAroundLabel(raw, matchIndex, matchLen) {
  const lineStart = raw.lastIndexOf("\n", matchIndex - 1) + 1;
  const lineEndIdx = raw.indexOf("\n", matchIndex);
  const line = raw.slice(lineStart, lineEndIdx === -1 ? raw.length : lineEndIdx);
  const rel = matchIndex - lineStart;
  const beforeNums = nextNumbers(line.slice(0, rel), 8);
  const afterNums = nextNumbers(line.slice(rel + matchLen), 8);
  // MATCH DETAILS rows are `leftValue  LABEL  rightValue` on one line.
  if (beforeNums.length && afterNums.length) return [beforeNums[beforeNums.length - 1], afterNums[0]];
  const afterBlock = raw.slice(matchIndex + matchLen, matchIndex + matchLen + 100);
  const afterLine = numbersOnNextValueLine(afterBlock);
  if (afterLine.length >= 2) return afterLine;
  if (afterLine.length) return afterLine;
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
      if (spec.key === "180") {
        const usable = nums.filter((n) => n >= 0 && n <= 30 && n === Math.floor(n));
        if (!usable.length) continue;
        const a = usable[0];
        const b = usable[1];
        if (stats.home180 == null) stats.home180 = homeFirst || b == null ? a : b;
        if (b != null && stats.away180 == null) stats.away180 = homeFirst ? b : a;
        continue;
      }
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
  const text = String(raw);
  const score = text.match(/\b([0-5])\s*[-–:]\s*([0-5])\b/);
  let a;
  let b;
  let index = 0;
  if (score) {
    a = Number(score[1]);
    b = Number(score[2]);
    index = score.index;
  } else {
    // Header score box often OCRs as `1] 5` without a dash. Stay in the header
    // so checkout fractions like 1/2 5/44 cannot be read as the match score.
    const cut = text.search(/3[\s-]?dart|\d{2}\.\d{2}|first\s*9|checkout rate|highest\s*finish|%/i);
    const header = text.slice(0, cut === -1 ? Math.min(450, text.length) : cut);
    const loose = header.match(/\b([0-5])[\s\]|:._-]{1,6}([0-5])\b/);
    if (loose && (Number(loose[1]) === 5 || Number(loose[2]) === 5) && loose[1] !== loose[2]) {
      a = Number(loose[1]);
      b = Number(loose[2]);
      index = loose.index;
    }
  }
  if (a == null || b == null) return null;
  if (a > 5 || b > 5) return null;
  const before = text.slice(0, index).toLowerCase();
  const homeHits = nameHitsAny(before, homeNames);
  const awayHits = nameHitsAny(before, awayNames);
  const homeFirst = homeHits === awayHits ? true : homeHits > awayHits;
  return {
    homeLegs: homeFirst ? a : b,
    awayLegs: homeFirst ? b : a,
  };
}

function isInt(n) {
  return n != null && Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9;
}

function looksLikeAvg(n) {
  if (n == null || !Number.isFinite(n)) return false;
  if (n >= 20 && n <= 140 && !isInt(n)) return true;
  if (n >= 1000 && n <= 9999 && isInt(n)) return true;
  return false;
}

function restoreCompactAvg(n) {
  if (n >= 1000 && n <= 9999 && isInt(n)) return n / 100;
  return n;
}

function normalizePairLine(line) {
  return String(line || "")
    .replace(/]/g, "7")
    .replace(/\bG0\b/g, "60")
    .replace(/\bO\b/g, "0")
    .replace(/\bJ\b/g, "3")
    .replace(/\bB\b/g, "8")
    .replace(/\bI\b/g, "1")
    .replace(/\bl\b/g, "1")
    .replace(/\|/g, "1");
}

function extractLayoutPairs(text) {
  const pairs = [];
  for (const rawLine of String(text || "").split(/\n/)) {
    const line = normalizePairLine(rawLine).trim();
    if (!line) continue;
    if (/match\s*details|straight\s*in|double\s*out|welcome|best\s*of/i.test(line) && nextNumbers(line, 1).length < 2) continue;
    const fracs = [...line.matchAll(/(\d{1,3})\s*\/\s*(\d{1,3})/g)].map((m) => ({ made: toNum(m[1]), att: toNum(m[2]) }));
    if (fracs.length >= 2) {
      pairs.push({ kind: "frac", a: fracs[0].made, b: fracs[1].made, raw: line });
      continue;
    }
    const pct = /%/.test(line);
    const darts = /darts/i.test(line);
    const nums = nextNumbers(line, 4);
    if (nums.length < 2) continue;
    if (nums.length >= 3 && PAGE2_BANDS.map(Number).includes(nums[1]) && isInt(nums[0]) && isInt(nums[2])) {
      pairs.push({ kind: "int", a: nums[0], b: nums[2], raw: line });
      continue;
    }
    if (looksLikeAvg(nums[0]) && looksLikeAvg(nums[nums.length - 1])) {
      pairs.push({
        kind: "avg",
        a: restoreCompactAvg(nums[0]),
        b: restoreCompactAvg(nums[nums.length - 1]),
        raw: line,
      });
      continue;
    }
    if (pct) {
      pairs.push({ kind: "pct", a: nums[0], b: nums[1], raw: line });
      continue;
    }
    if (darts) {
      pairs.push({ kind: "darts", a: nums[0], b: nums[1], raw: line });
      continue;
    }
    const a = nums[0];
    const b = nums[1];
    if (!isInt(a) || !isInt(b)) continue;
    pairs.push({ kind: "int", a, b, raw: line });
  }
  return pairs;
}

function assignPair(stats, key, pair, homeFirst) {
  if (!pair) return;
  const homeKey = `home${key}`;
  const awayKey = `away${key}`;
  const left = homeFirst ? pair.a : pair.b;
  const right = homeFirst ? pair.b : pair.a;
  if (stats[homeKey] == null && left != null) stats[homeKey] = left;
  if (stats[awayKey] == null && right != null) stats[awayKey] = right;
}

function longestSmallIntRun(pairs) {
  let best = [];
  let cur = [];
  for (const p of pairs) {
    const small = p.kind === "int" && p.a >= 0 && p.a <= 40 && p.b >= 0 && p.b <= 40;
    if (small) {
      cur.push(p);
      if (cur.length > best.length) best = cur.slice();
    } else {
      cur = [];
    }
  }
  return best;
}

function applyMatchDetailsLayout(raw, stats, homeFirst) {
  const pairs = extractLayoutPairs(raw);
  if (!pairs.length) return;

  const avgPairs = pairs.filter((p) => p.kind === "avg");
  if (avgPairs.length) assignPair(stats, "Avg", avgPairs[0], homeFirst);

  const frac = pairs.find((p) => p.kind === "frac");
  if (frac && stats.homeLegs == null && stats.awayLegs == null) {
    // In 501 each won leg is a checkout, so Checkouts made == legs won.
    if ((frac.a === 5) !== (frac.b === 5) && frac.a <= 5 && frac.b <= 5) {
      assignPair(stats, "Legs", frac, homeFirst);
    }
  }

  const afterMeta = [];
  let seenAvg = !avgPairs.length;
  for (const p of pairs) {
    if (p.kind === "avg") {
      seenAvg = true;
      continue;
    }
    if (!seenAvg) continue;
    if (p.kind === "pct" || p.kind === "frac") continue;
    afterMeta.push(p);
  }
  const finishPair = afterMeta.find(
    (p) => p.kind === "int" && p.a <= 170 && p.b <= 170 && Math.min(p.a, p.b) < 100 && Math.max(p.a, p.b) >= 40
  );
  if (finishPair) assignPair(stats, "Checkout", finishPair, homeFirst);

  const dartsPairs = pairs.filter((p) => p.kind === "darts");
  if (dartsPairs.length) assignPair(stats, "BestLeg", dartsPairs[0], homeFirst);

  const run = longestSmallIntRun(pairs);
  // Page 2 of MATCH DETAILS starts with 180 counts (small integers), not best-leg darts.
  if (run.length >= 6 && run[0].a <= 12 && run[0].b <= 12) {
    PAGE2_BANDS.forEach((key, i) => {
      if (run[i]) assignPair(stats, key, run[i], homeFirst);
    });
  }
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

  applyMatchDetailsLayout(raw, stats, homeFirst);
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
