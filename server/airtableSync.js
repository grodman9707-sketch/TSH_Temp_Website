// Optional Airtable staff spreadsheet. Never includes passwords or reset codes.

const API = "https://api.airtable.com/v0";
const META = "https://api.airtable.com/v0/meta";

let last = { ok: false, at: "", error: "", players: 0, standings: 0, fixtures: 0 };

export function airtableConfigured() {
  return Boolean(String(process.env.AIRTABLE_TOKEN || "").trim() && String(process.env.AIRTABLE_BASE_ID || "").trim());
}

export function airtableStatus() {
  return { configured: airtableConfigured(), ...last };
}

function token() {
  return String(process.env.AIRTABLE_TOKEN || "").trim();
}

function baseId() {
  return String(process.env.AIRTABLE_BASE_ID || "").trim();
}

function userLeagueIds(u) {
  if (Array.isArray(u?.leagueIds)) return [...new Set(u.leagueIds.map(Number).filter(Boolean))];
  if (u?.leagueId) return [Number(u.leagueId)];
  return [];
}

function leagueTitle(db, league) {
  if (!league) return "";
  const regional = (db.regionals || []).find((r) => r.id === league.regionalId);
  return `${regional?.fullTitle || "TSH"} ${league.name || ""}`.trim();
}

function roleLabel(u) {
  const roles = Array.isArray(u?.roles) ? u.roles.map(String) : [];
  if (u?.role && u.role !== "player") roles.unshift(String(u.role));
  const set = new Set(roles.filter((r) => r && r !== "player"));
  if (set.has("owner")) return "Owner";
  if (set.has("head_admin")) return "Head Admin";
  if (set.has("admin")) return "Admin";
  return "Player";
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function standingsRows(db) {
  const out = [];
  for (const league of db.leagues || []) {
    const players = (db.users || []).filter((u) => userLeagueIds(u).includes(league.id));
    const rows = players.map((p) => ({
      playerId: p.id,
      name: p.nickname || p.name,
      avg: num(p.avg),
      played: 0,
      won: 0,
      lost: 0,
      legsFor: 0,
      legsAgainst: 0,
      points: 0,
      oneEighties: 0,
      matchAvgSum: 0,
      matchAvgCount: 0,
    }));
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
    for (const f of (db.fixtures || []).filter((x) => x.leagueId === league.id && x.status === "played")) {
      const home = byId[f.homeId];
      const away = byId[f.awayId];
      if (!home || !away) continue;
      home.played += 1;
      away.played += 1;
      home.legsFor += Number(f.homeLegs) || 0;
      home.legsAgainst += Number(f.awayLegs) || 0;
      away.legsFor += Number(f.awayLegs) || 0;
      away.legsAgainst += Number(f.homeLegs) || 0;
      home.oneEighties += f.home180 || f.homeOneEighties || 0;
      away.oneEighties += f.away180 || f.awayOneEighties || 0;
      if (Number(f.homeAvg)) {
        home.matchAvgSum += Number(f.homeAvg);
        home.matchAvgCount += 1;
      }
      if (Number(f.awayAvg)) {
        away.matchAvgSum += Number(f.awayAvg);
        away.matchAvgCount += 1;
      }
      home.points += Number(f.homeLegs) || 0;
      away.points += Number(f.awayLegs) || 0;
      if (f.homeLegs > f.awayLegs) {
        home.won += 1;
        home.points += 2;
        away.lost += 1;
      } else if (f.awayLegs > f.homeLegs) {
        away.won += 1;
        away.points += 2;
        home.lost += 1;
      }
    }
    const regional = (db.regionals || []).find((r) => r.id === league.regionalId);
    for (const r of rows) {
      out.push({
        key: `${league.id}:${r.playerId}`,
        player: r.name,
        division: leagueTitle(db, league),
        regional: regional?.fullTitle || regional?.name || "",
        played: r.played,
        won: r.won,
        lost: r.lost,
        legsFor: r.legsFor,
        legsAgainst: r.legsAgainst,
        diff: r.legsFor - r.legsAgainst,
        points: r.points,
        oneEighties: r.oneEighties,
        avg: r.matchAvgCount ? Math.round((r.matchAvgSum / r.matchAvgCount) * 10) / 10 : r.avg,
      });
    }
  }
  return out;
}

export function airtablePlayerRecords(db) {
  return (db.users || []).map((u) => {
    const leagues = userLeagueIds(u)
      .map((id) => (db.leagues || []).find((l) => l.id === id))
      .filter(Boolean);
    const regionals = [...new Set(leagues.map((l) => l.regionalId))]
      .map((id) => (db.regionals || []).find((r) => r.id === id)?.fullTitle || "")
      .filter(Boolean);
    return {
      fields: {
        "Player Key": String(u.id),
        Name: u.name || "",
        Nickname: u.nickname || "",
        Email: u.email || "",
        DartCounter: u.dartcounterName || "",
        "3DA": num(u.avg),
        Role: roleLabel(u),
        Regionals: regionals.join(" · ") || (u.regionalChoice === "both" ? "TSH Europe · TSH Americas" : u.regionalChoice === "americas" ? "TSH Americas" : "TSH Europe"),
        Divisions: leagues.map((l) => leagueTitle(db, l)).join(" · ") || "Unplaced",
        Status: leagues.length ? "Placed" : "Unplaced",
      },
    };
  });
}

export function airtableStandingRecords(db) {
  return standingsRows(db).map((r) => ({
    fields: {
      "Row Key": r.key,
      Player: r.player,
      Division: r.division,
      Regional: r.regional,
      Played: r.played,
      Won: r.won,
      Lost: r.lost,
      "Legs For": r.legsFor,
      "Legs Against": r.legsAgainst,
      Diff: r.diff,
      Points: r.points,
      "180s": r.oneEighties,
      Avg: r.avg,
    },
  }));
}

export function airtableFixtureRecords(db) {
  const users = new Map((db.users || []).map((u) => [u.id, u]));
  return (db.fixtures || []).map((f) => {
    const league = (db.leagues || []).find((l) => l.id === f.leagueId);
    const home = users.get(f.homeId);
    const away = users.get(f.awayId);
    const played = f.status === "played";
    return {
      fields: {
        "Fixture Key": String(f.id),
        Division: leagueTitle(db, league),
        Week: num(f.week) || 0,
        Home: home?.nickname || home?.name || "",
        Away: away?.nickname || away?.name || "",
        Score: played ? `${f.homeLegs ?? ""}–${f.awayLegs ?? ""}` : "",
        Status: f.status || "",
        Date: f.date || "",
        "Home Avg": num(f.homeAvg),
        "Away Avg": num(f.awayAvg),
        "Home 180s": num(f.home180 || f.homeOneEighties) || 0,
        "Away 180s": num(f.away180 || f.awayOneEighties) || 0,
        "Top Checkout": num(f.topCheckout) || 0,
      },
    };
  });
}

export const AIRTABLE_TABLES = [
  {
    name: "Players",
    key: "Player Key",
    records: airtablePlayerRecords,
    fields: [
      { name: "Player Key", type: "singleLineText" },
      { name: "Name", type: "singleLineText" },
      { name: "Nickname", type: "singleLineText" },
      { name: "Email", type: "email" },
      { name: "DartCounter", type: "singleLineText" },
      { name: "3DA", type: "number", options: { precision: 1 } },
      { name: "Role", type: "singleLineText" },
      { name: "Regionals", type: "singleLineText" },
      { name: "Divisions", type: "multilineText" },
      { name: "Status", type: "singleLineText" },
    ],
  },
  {
    name: "Standings",
    key: "Row Key",
    records: airtableStandingRecords,
    fields: [
      { name: "Row Key", type: "singleLineText" },
      { name: "Player", type: "singleLineText" },
      { name: "Division", type: "singleLineText" },
      { name: "Regional", type: "singleLineText" },
      { name: "Played", type: "number", options: { precision: 0 } },
      { name: "Won", type: "number", options: { precision: 0 } },
      { name: "Lost", type: "number", options: { precision: 0 } },
      { name: "Legs For", type: "number", options: { precision: 0 } },
      { name: "Legs Against", type: "number", options: { precision: 0 } },
      { name: "Diff", type: "number", options: { precision: 0 } },
      { name: "Points", type: "number", options: { precision: 0 } },
      { name: "180s", type: "number", options: { precision: 0 } },
      { name: "Avg", type: "number", options: { precision: 1 } },
    ],
  },
  {
    name: "Fixtures",
    key: "Fixture Key",
    records: airtableFixtureRecords,
    fields: [
      { name: "Fixture Key", type: "singleLineText" },
      { name: "Division", type: "singleLineText" },
      { name: "Week", type: "number", options: { precision: 0 } },
      { name: "Home", type: "singleLineText" },
      { name: "Away", type: "singleLineText" },
      { name: "Score", type: "singleLineText" },
      { name: "Status", type: "singleLineText" },
      { name: "Date", type: "singleLineText" },
      { name: "Home Avg", type: "number", options: { precision: 1 } },
      { name: "Away Avg", type: "number", options: { precision: 1 } },
      { name: "Home 180s", type: "number", options: { precision: 0 } },
      { name: "Away 180s", type: "number", options: { precision: 0 } },
      { name: "Top Checkout", type: "number", options: { precision: 0 } },
    ],
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function airtableFetch(url, { method = "GET", body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || res.statusText;
    throw new Error(`Airtable ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  if (fetchImpl === fetch) await sleep(220);
  return data;
}

async function ensureTables(fetchImpl) {
  const schema = await airtableFetch(`${META}/bases/${baseId()}/tables`, { fetchImpl });
  const have = new Map((schema.tables || []).map((t) => [t.name, t]));
  for (const spec of AIRTABLE_TABLES) {
    if (have.has(spec.name)) continue;
    await airtableFetch(`${META}/bases/${baseId()}/tables`, {
      method: "POST",
      fetchImpl,
      body: {
        name: spec.name,
        description: "TSH Darts League staff spreadsheet. Synced from the website. Do not edit keys.",
        fields: spec.fields,
      },
    });
  }
}

async function listAll(table, fetchImpl) {
  const records = [];
  let offset = "";
  do {
    const q = new URL(`${API}/${baseId()}/${encodeURIComponent(table)}`);
    q.searchParams.set("pageSize", "100");
    if (offset) q.searchParams.set("offset", offset);
    const page = await airtableFetch(q.toString(), { fetchImpl });
    records.push(...(page.records || []));
    offset = page.offset || "";
  } while (offset);
  return records;
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function upsertTable(spec, db, fetchImpl) {
  const rows = spec.records(db);
  for (const batch of chunks(rows, 10)) {
    await airtableFetch(`${API}/${baseId()}/${encodeURIComponent(spec.name)}`, {
      method: "PATCH",
      fetchImpl,
      body: {
        performUpsert: { fieldsToMergeOn: [spec.key] },
        typecast: true,
        records: batch,
      },
    });
  }
  const existing = await listAll(spec.name, fetchImpl);
  const keep = new Set(rows.map((r) => String(r.fields[spec.key])));
  const stale = existing.filter((r) => !keep.has(String(r.fields?.[spec.key] || "")));
  for (const batch of chunks(stale, 10)) {
    const ids = batch.map((r) => r.id).filter(Boolean);
    if (!ids.length) continue;
    const q = new URL(`${API}/${baseId()}/${encodeURIComponent(spec.name)}`);
    for (const id of ids) q.searchParams.append("records[]", id);
    await airtableFetch(q.toString(), { method: "DELETE", fetchImpl });
  }
  return rows.length;
}

export async function syncAirtable(db, { fetchImpl = fetch } = {}) {
  if (!airtableConfigured()) throw new Error("Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID on the web service.");
  try {
    await ensureTables(fetchImpl);
    const players = await upsertTable(AIRTABLE_TABLES[0], db, fetchImpl);
    const standings = await upsertTable(AIRTABLE_TABLES[1], db, fetchImpl);
    const fixtures = await upsertTable(AIRTABLE_TABLES[2], db, fetchImpl);
    last = { ok: true, at: new Date().toISOString(), error: "", players, standings, fixtures };
    return last;
  } catch (err) {
    last = { ok: false, at: new Date().toISOString(), error: String(err.message || err), players: last.players || 0, standings: last.standings || 0, fixtures: last.fixtures || 0 };
    throw err;
  }
}
