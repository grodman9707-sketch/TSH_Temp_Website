const WIKI_UA =
  "TSHDartsLeague/1.0 (https://github.com/grodman9707-sketch/TSH_Temp_Website; thesocialhubinformation@gmail.com)";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const CACHE_MS = 5 * 60 * 1000;
const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};
const MONTH_RE = Object.keys(MONTHS).join("|");
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FALLBACK_EVENTS = [
  { name: "Premier League", start: "2026-02-05", end: "2026-05-28", venue: "Various UK & Europe" },
  { name: "World Matchplay", start: "2026-07-18", end: "2026-07-26", venue: "Winter Gardens, Blackpool" },
  { name: "Australian Darts Masters", start: "2026-08-21", end: "2026-08-22", venue: "Wollongong" },
  { name: "World Series of Darts Finals", start: "2026-09-17", end: "2026-09-20", venue: "Amsterdam" },
  { name: "World Grand Prix", start: "2026-09-28", end: "2026-10-04", venue: "Leicester" },
  { name: "European Championship", start: "2026-10-22", end: "2026-10-25", venue: "Dortmund" },
  { name: "Grand Slam of Darts", start: "2026-11-14", end: "2026-11-22", venue: "Wolverhampton" },
  { name: "Players Championship Finals", start: "2026-11-27", end: "2026-11-29", venue: "Minehead" },
];

let cache = { at: 0, payload: null };

function londonParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function todayYmd(date = new Date()) {
  const { y, m, d } = londonParts(date);
  return ymd(y, m - 1, d);
}

function ymd(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseYmd(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return { y, m: m - 1, d };
}

function addDays(value, days) {
  const { y, m, d } = parseYmd(value);
  const dt = new Date(Date.UTC(y, m, d + days));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

function fmtRange(start, end) {
  const s = parseYmd(start);
  const e = parseYmd(end);
  if (start === end) return `${s.d} ${SHORT_MONTHS[s.m]}`;
  if (s.m === e.m && s.y === e.y) return `${s.d}–${e.d} ${SHORT_MONTHS[s.m]}`;
  if (s.y === e.y) return `${s.d} ${SHORT_MONTHS[s.m]} – ${e.d} ${SHORT_MONTHS[e.m]}`;
  return `${s.d} ${SHORT_MONTHS[s.m]} ${s.y} – ${e.d} ${SHORT_MONTHS[e.m]} ${e.y}`;
}

function stripWiki(raw) {
  let t = String(raw || "");
  t = t.replace(/\{\{flagathlete\|\[\[([^|\]]+)(?:\|[^\]]+)?\]\]\|[^}]*\}\}/gi, "$1");
  t = t.replace(/\{\{flagicon\|[^}]*\}\}/gi, "");
  t = t.replace(/\{\{(?:nowrap|small)\|([^}]*)\}\}/gi, "$1");
  t = t.replace(/\{\{dts\|([^}]+)\}\}/gi, "$1");
  for (let i = 0; i < 8; i += 1) {
    const next = t.replace(/\{\{[^{}]*\}\}/g, " ");
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\[\[(?:File|Image|Category|Template):[^\]]*\]\]/gi, "");
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1");
  t = t.replace(/'''|''|<[^>]+>/g, "");
  t = t.replace(/&nbsp;|&#160;/gi, " ");
  t = t.replace(/^\|+/, "");
  return t.replace(/\s+/g, " ").trim();
}

function parseWikiDateRange(text, defaultYear) {
  const t = stripWiki(text)
    .replace(/[–—]/g, "-")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  let m = t.match(new RegExp(`(\\d{1,2})\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?\\s*-\\s*(\\d{1,2})\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?`, "i"));
  if (m) {
    const y2 = Number(m[6] || m[3] || defaultYear);
    const y1 = Number(m[3] || (MONTHS[m[2].toLowerCase()] > MONTHS[m[5].toLowerCase()] ? y2 - 1 : y2));
    return { start: ymd(y1, MONTHS[m[2].toLowerCase()], Number(m[1])), end: ymd(y2, MONTHS[m[5].toLowerCase()], Number(m[4])) };
  }
  m = t.match(new RegExp(`(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?`, "i"));
  if (m) {
    const y = Number(m[4] || defaultYear);
    const mo = MONTHS[m[3].toLowerCase()];
    return { start: ymd(y, mo, Number(m[1])), end: ymd(y, mo, Number(m[2])) };
  }
  m = t.match(new RegExp(`(\\d{1,2})\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?`, "i"));
  if (m) {
    const y = Number(m[3] || defaultYear);
    const value = ymd(y, MONTHS[m[2].toLowerCase()], Number(m[1]));
    return { start: value, end: value };
  }
  return null;
}

function hasChampion(value) {
  const t = stripWiki(value);
  if (!t || /^(tbc|tba|-|–|—|n\/a)$/i.test(t)) return false;
  return /[A-Za-z]{3,}/.test(t);
}

function eventKind(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("premier league") && !n.includes("anz")) return "premier-league";
  if (n.includes("world matchplay") && !n.includes("women")) return "world-matchplay";
  return "other";
}

function isTelevisedName(name) {
  const n = String(name || "").toLowerCase();
  if (!n || n.length > 80) return false;
  if (/prize money|total|winner|finalist|date|event|venue|champion|score|runner/.test(n) && n.length < 18) return false;
  if (/players championship\s*\d|challenge tour|development tour|q-school|women'?s series|asian tour|anz premier|tour card/i.test(n)) {
    return false;
  }
  return /world|premier league|matchplay|masters|grand prix|grand slam|uk open|european championship|world cup|world series|players championship finals/i.test(n);
}

function tickerLabel(name) {
  let s = String(name || "PDC")
    .replace(/\bDarts\b/gi, " ")
    .replace(/\s+of\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/world series of finals/i.test(s)) s = "World Series Finals";
  return s.toUpperCase().slice(0, 32);
}

function shortVenue(venue) {
  return String(venue || "")
    .replace(/\s*,\s*(England|Germany|Netherlands|United States|Australia|New Zealand|Belgium|Ireland|Scotland|Wales).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPlayer(name) {
  const n = String(name || "")
    .replace(/_/g, " ")
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/\d+(\.\d+)?/g, "")
    .trim();
  if (n.length < 4 || n.length > 40) return false;
  if (/^(file|image|category|template|wikipedia):/i.test(n)) return false;
  if (/\b(arena|gardens|championship|darts|england|london|blackpool|venue|round|night|statistics|average|checkout)\b/i.test(n)) {
    return false;
  }
  return /[A-Za-z]{2,}(?:\s+[A-Za-z.'-]+){1,3}$/.test(n);
}

function cleanPlayer(name) {
  return String(name || "")
    .replace(/_/g, " ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\d+(\.\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function wikiWikitext(title) {
  const url = `${WIKI_API}?${new URLSearchParams({
    action: "parse",
    page: title,
    prop: "wikitext",
    format: "json",
    redirects: "1",
  })}`;
  const res = await fetch(url, {
    headers: { "User-Agent": WIKI_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data?.parse?.wikitext?.["*"] || "";
}

function extractSection(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.slice(1).search(endRe);
  return end > 0 ? rest.slice(0, end + 1) : rest;
}

function parseCalendarEvents(wikitext, year) {
  const block =
    extractSection(wikitext, /==\s*Televised events\s*==/i, /\n==\s*(?:Pro Tour|Secondary tours|Global Affiliate)\s*==/i) ||
    wikitext;
  const events = [];
  const seen = new Set();
  for (const row of block.split(/\n\|-/)) {
    const cells = row
      .split("||")
      .map((cell) => cell.replace(/^\|/, "").trim())
      .filter((cell, i, arr) => i === 0 || cell.length || arr.length > 2);
    if (cells.length < 2) continue;
    let dateCell = cells[0];
    let nameIdx = 1;
    if (/^\d+$/.test(stripWiki(cells[0])) && cells.length >= 3) {
      dateCell = cells[1];
      nameIdx = 2;
    }
    const range = parseWikiDateRange(dateCell, year);
    if (!range) continue;
    const name = stripWiki(cells[nameIdx]);
    if (!isTelevisedName(name)) continue;
    const venue = stripWiki(cells[nameIdx + 1] || "");
    const champion = cells[nameIdx + 2] || "";
    const key = `${name.toLowerCase()}|${range.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      name,
      venue,
      start: range.start,
      end: range.end,
      complete: hasChampion(champion) && range.end < todayYmd(),
      kind: eventKind(name),
    });
  }
  return events;
}

function headingDate(heading, year) {
  const range = parseWikiDateRange(heading.replace(/Night\s*\d+/i, ""), year);
  return range?.start || null;
}

function parseMatchesFromSection(section, dateYmd, eventName) {
  const matches = [];
  const lines = section.split("\n");
  for (const line of lines) {
    if (!line.includes("[[") && !/flagathlete/i.test(line)) continue;
    if (/statistics|highest checkout|night's total/i.test(line)) continue;
    const flagged = [...line.matchAll(/\{\{flagathlete\|\[\[([^|\]]+)/gi)].map((m) => cleanPlayer(m[1]));
    const linked = [...line.matchAll(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g)]
      .map((m) => cleanPlayer(m[1]))
      .filter(isLikelyPlayer);
    const players = (flagged.length >= 2 ? flagged : linked).filter(isLikelyPlayer);
    const unique = [];
    for (const player of players) {
      if (!unique.some((p) => p.toLowerCase() === player.toLowerCase())) unique.push(player);
    }
    if (unique.length !== 2) continue;
    const vs = /\bvs\.?\b|\bv\b/i.test(line);
    const score = line.match(/(\d+)\s*[–−-]\s*(\d+)/);
    const complete = Boolean(score) && !vs;
    matches.push({
      event: eventName,
      dateYmd,
      home: unique[0],
      away: unique[1],
      score: complete ? `${score[1]}–${score[2]}` : "",
      complete,
    });
  }
  return matches;
}

function parseTournamentMatches(wikitext, year, eventName) {
  const matches = [];
  const headingRe = /(?:^|\n)={2,4}\s*([^\n=]+?)\s*={2,4}/g;
  const headings = [];
  let found;
  while ((found = headingRe.exec(wikitext))) {
    headings.push({ title: found[1].trim(), index: found.index, bodyStart: found.index + found[0].length });
  }
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const date = headingDate(heading.title, year);
    if (!date) continue;
    if (!/night|january|february|march|april|may|june|july|august|september|october|november|december/i.test(heading.title)) {
      continue;
    }
    const body = wikitext.slice(heading.bodyStart, headings[i + 1]?.index || wikitext.length);
    matches.push(...parseMatchesFromSection(body, date, eventName));
  }
  return matches;
}

function fallbackEvents() {
  const today = todayYmd();
  return FALLBACK_EVENTS.map((ev) => ({
    ...ev,
    complete: ev.end < today,
    kind: eventKind(ev.name),
  }));
}

function featuredMatches(matches, today, eventEnd) {
  const todays = matches.filter((m) => m.dateYmd === today);
  if (todays.length) {
    const unfinished = todays.filter((m) => !m.complete);
    return (unfinished.length ? unfinished : todays).slice(0, 8);
  }
  const next = matches.filter((m) => m.dateYmd >= today && (!m.complete || m.dateYmd > today)).filter((m) => m.dateYmd <= eventEnd);
  const upcoming = next.filter((m) => !m.complete);
  if (upcoming.length) return upcoming.slice(0, 8);
  return [];
}

function matchItems(matches, label, today) {
  return matches.map((m) => {
    const score = m.complete && m.score ? ` — ${m.score}` : "";
    return {
      div: tickerLabel(label),
      text: `${m.home} vs ${m.away}${score}`,
      live: !m.complete && m.dateYmd === today,
    };
  });
}

function upcomingEventItems(events, today, limit = 6) {
  const open = events
    .filter((ev) => !ev.complete && ev.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const unique = [];
  const seen = new Set();
  for (const ev of open) {
    const key = ev.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ev);
  }
  return unique.slice(0, limit).map((ev) => {
    const venue = shortVenue(ev.venue);
    const when = fmtRange(ev.start, ev.end);
    const live = ev.start <= today && ev.end >= today;
    return {
      div: tickerLabel(ev.name),
      text: live ? `Live now${venue ? ` · ${venue}` : ""}` : `${when}${venue ? ` · ${venue}` : ""}`,
      live,
    };
  });
}

async function loadWikiEvents() {
  const today = todayYmd();
  const { y, m } = londonParts();
  const years = [y];
  if (m === 1) years.unshift(y - 1);
  if (m >= 11) years.push(y + 1);

  const yearTexts = await Promise.all(years.map((year) => wikiWikitext(`${year} in PDC`)));
  const events = [];
  yearTexts.forEach((text, i) => {
    if (text) events.push(...parseCalendarEvents(text, years[i]));
  });

  const titles = [];
  for (const year of years) {
    titles.push({ year, title: `${year} Premier League Darts`, kind: "premier-league" });
    titles.push({ year, title: `${year} World Matchplay`, kind: "world-matchplay" });
  }
  const pages = await Promise.all(titles.map((t) => wikiWikitext(t.title)));
  const matches = { "premier-league": [], "world-matchplay": [] };
  pages.forEach((text, i) => {
    if (!text) return;
    const meta = titles[i];
    const name = meta.kind === "premier-league" ? "Premier League" : "World Matchplay";
    matches[meta.kind].push(...parseTournamentMatches(text, meta.year, name));
  });

  return { today, events: events.length ? events : fallbackEvents(), matches };
}

function buildItems({ today, events, matches }) {
  const focus = ["premier-league", "world-matchplay"];
  const liveOrScheduled = [];
  for (const kind of focus) {
    const ev = events
      .filter((item) => item.kind === kind)
      .sort((a, b) => b.end.localeCompare(a.end))[0];
    if (!ev) continue;
    const windowStart = addDays(ev.start, -1);
    const onNow = today >= windowStart && today <= ev.end && !ev.complete;
    if (!onNow) continue;
    const picked = featuredMatches(matches[kind] || [], today, ev.end);
    if (picked.length) {
      liveOrScheduled.push(...matchItems(picked, ev.name, today));
      continue;
    }
    const venue = shortVenue(ev.venue);
    liveOrScheduled.push({
      div: tickerLabel(ev.name),
      text: today >= ev.start ? `Live now${venue ? ` · ${venue}` : ""}` : `${fmtRange(ev.start, ev.end)}${venue ? ` · ${venue}` : ""}`,
      live: today >= ev.start,
    });
  }
  if (liveOrScheduled.length) return { items: liveOrScheduled, mode: "matchups" };
  const upcoming = upcomingEventItems(events, today);
  if (upcoming.length) return { items: upcoming, mode: "upcoming" };
  return {
    items: [{ div: "PDC", text: "Watch this space for the next live Sky Sports darts", live: false }],
    mode: "empty",
  };
}

export async function getPdcTicker() {
  if (cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload;
  try {
    const payload = { ok: true, ...buildItems(await loadWikiEvents()) };
    cache = { at: Date.now(), payload };
    return payload;
  } catch (err) {
    console.error("PDC ticker", err);
    if (cache.payload) return cache.payload;
    const fallback = { ok: true, ...buildItems({ today: todayYmd(), events: fallbackEvents(), matches: { "premier-league": [], "world-matchplay": [] } }) };
    cache = { at: Date.now(), payload: fallback };
    return fallback;
  }
}

export function warmPdcTicker() {
  getPdcTicker().catch(() => {});
}
