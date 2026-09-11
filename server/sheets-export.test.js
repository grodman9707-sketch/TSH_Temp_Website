// Google Sheets pull-feed (API key + CSV/JSON export).
// Run: `node server/sheets-export.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { snapshotPayload } from "./postgresBackup.js";
import {
  DEFAULT_STAFF_SPREADSHEET_ID,
  generateSheetsApiKey,
  keysEqual,
  setSheetsApiKey,
  sheetsApiKeyValid,
  sheetsCsv,
  sheetsKeyPayload,
  sheetsRows,
  staffSpreadsheetUrl,
  toCsv,
} from "./sheetsExport.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const db = {
  regionals: [
    { id: 1, fullTitle: "TSH Europe", name: "Europe" },
    { id: 2, fullTitle: "TSH Americas", name: "Americas" },
  ],
  leagues: [{ id: 1, regionalId: 1, name: "Division 1" }],
  users: [
    {
      id: 9,
      name: "Pat Player",
      nickname: "Pat",
      email: "pat@test.com",
      password: "secret-pass",
      passwordReset: { code: "123456" },
      dartcounterName: "PatDC",
      avg: 51.2,
      role: "player",
      roles: [],
      leagueIds: [1],
      regionalChoice: "europe",
    },
  ],
  fixtures: [
    {
      id: 4,
      leagueId: 1,
      week: 1,
      homeId: 9,
      awayId: 9,
      status: "played",
      homeLegs: 5,
      awayLegs: 2,
      homeAvg: 54.1,
      awayAvg: 48,
      home180: 1,
      date: "2026-09-08",
    },
  ],
};

const csvQuoted = toCsv([{ Name: 'Pat, "the dart"', Notes: "line\nbreak" }], ["Name", "Notes"]);
check("csv quotes commas and quotes", csvQuoted.includes('"Pat, ""the dart"""'));
check("csv quotes newlines", csvQuoted.includes('"line\nbreak"'));

const players = sheetsRows(db, "players");
check("players export includes Pat", players[0].Name === "Pat Player");
check("players export includes staff email", players[0].Email === "pat@test.com");
check("players export never includes a password", !JSON.stringify(players).includes("secret-pass"));
check("players export never includes reset codes", !JSON.stringify(players).includes("123456"));

const standingsCsv = sheetsCsv(db, "standings");
check("standings csv has a header", standingsCsv.startsWith("Row Key,Player,Division"));
check("standings csv has Pat's row", standingsCsv.includes("Pat") && standingsCsv.includes("TSH Europe Division 1"));

setSheetsApiKey(db, { key: "tsh_testkey", userId: 1 });
check("configured key matches", sheetsApiKeyValid(db, "tsh_testkey") === true);
check("wrong key is rejected", sheetsApiKeyValid(db, "tsh_other") === false);
check("empty key is rejected", sheetsApiKeyValid(db, "") === false);
check("timing-safe equal rejects length mismatch", keysEqual("abc", "ab") === false);
check("generated keys use the tsh_ prefix", generateSheetsApiKey().startsWith("tsh_"));
check(
  "official staff spreadsheet is the league workbook",
  DEFAULT_STAFF_SPREADSHEET_ID === "1Frq5HEWdD_Dld8bIOCq0_CqH7BaTY_ikgIHzqYMMmLY"
);
check(
  "staff spreadsheet URL uses that id",
  staffSpreadsheetUrl() === "https://docs.google.com/spreadsheets/d/1Frq5HEWdD_Dld8bIOCq0_CqH7BaTY_ikgIHzqYMMmLY/edit"
);
const payload = sheetsKeyPayload("https://tshdartsleague.com", { configured: true, key: "tsh_testkey", createdAt: "2026-09-11" });
check("admin payload includes the workbook url", payload.workbook?.url === staffSpreadsheetUrl());
check("admin payload tabs are standings fixtures players", payload.workbook?.tabs?.map((t) => t.title).join(",") === "Players,Standings,Fixtures");
check("standings formula targets the live export", payload.workbook?.tabs?.some((t) => t.title === "Standings" && t.cell === "A1" && t.formula.includes("/api/export/standings.csv?key=tsh_testkey")));

const snap = snapshotPayload(db);
check("postgres snapshot keeps the sheets API key", snap.sheetsExport?.key === "tsh_testkey");
check("postgres snapshot still never sends passwords to Airtable-style exports", !JSON.stringify(players).includes("secret-pass"));

async function waitHealth(port, child) {
  const deadline = Date.now() + 15000;
  let lastErr;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw lastErr || new Error("server did not become healthy");
}

async function api(port, pathname, { method = "GET", token, key, body, headers: extra } = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, text, headers: res.headers, cors: res.headers.get("access-control-allow-origin") };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-sheets-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (buf) => {
  stderr += buf.toString();
});

try {
  await waitHealth(port, child);
  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const player = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Sheets Player",
      email: "sheets@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "SheetsDC",
      avg: 44,
    },
  });
  check("register player", player.status === 200 && player.data.token);

  const deniedRead = await api(port, "/api/admin/export-key", { token: player.data.token });
  check("players cannot read the sheets key", deniedRead.status === 403);

  const deniedGen = await api(port, "/api/admin/export-key", { method: "POST", token: player.data.token, body: {} });
  check("players cannot generate the sheets key", deniedGen.status === 403);

  const before = await api(port, "/api/export/standings.csv");
  check("export without a key is blocked", before.status === 401);

  const created = await api(port, "/api/admin/export-key", { method: "POST", token: ownerTok, body: {} });
  check("owner can generate a key", created.status === 200 && String(created.data.key || "").startsWith("tsh_"));
  check("owner response includes IMPORTDATA formulas", String(created.data.formulas?.standings || "").startsWith("=IMPORTDATA("));
  check(
    "owner response points at the staff spreadsheet",
    created.data.workbook?.id === "1Frq5HEWdD_Dld8bIOCq0_CqH7BaTY_ikgIHzqYMMmLY" &&
      String(created.data.workbook?.url || "").includes("1Frq5HEWdD_Dld8bIOCq0_CqH7BaTY_ikgIHzqYMMmLY")
  );
  const key = created.data.key;

  const shown = await api(port, "/api/admin/export-key", { token: ownerTok });
  check("owner can copy the key later", shown.status === 200 && shown.data.key === key);
  check("owner can reopen the staff spreadsheet url", shown.data.workbook?.url === created.data.workbook?.url);

  const wrong = await api(port, `/api/export/standings.csv?key=nope`);
  check("wrong query key is rejected", wrong.status === 401);

  const csv = await api(port, `/api/export/standings.csv?key=${encodeURIComponent(key)}`);
  check("csv export with query key works", csv.status === 200 && csv.headers.get("content-type")?.includes("text/csv"));
  check("csv looks like a sheets table", csv.text.includes("Row Key") && csv.text.includes("Player"));
  check("csv never includes passwords", !csv.text.includes("Rodm@n85") && !csv.text.includes("pass1234"));
  check("csv allows cross-origin clients", csv.cors === "*");

  const bearer = await api(port, "/api/export/players.json", { headers: { Authorization: `Bearer ${key}` } });
  check("json export accepts Bearer key", bearer.status === 200 && Array.isArray(bearer.data.rows));
  check("json players include the registered player", bearer.data.rows.some((r) => r.Email === "sheets@test.com"));
  check("json players omit passwords", !JSON.stringify(bearer.data).includes("pass1234"));

  const headerKey = await api(port, "/api/export/fixtures.json", { headers: { "X-Api-Key": key } });
  check("json export accepts X-Api-Key", headerKey.status === 200 && headerKey.data.table === "fixtures");

  const catalog = await api(port, `/api/export?key=${encodeURIComponent(key)}`);
  check("catalog lists the three tables", Array.isArray(catalog.data.tables) && catalog.data.tables.join(",") === "players,standings,fixtures");

  const options = await fetch(`http://127.0.0.1:${port}/api/export/standings.csv`, { method: "OPTIONS" });
  check("OPTIONS preflight is allowed", options.status === 204 && options.headers.get("access-control-allow-origin") === "*");

  const unknown = await api(port, `/api/export/passwords.csv?key=${encodeURIComponent(key)}`);
  check("unknown tables 404", unknown.status === 404);

  const revoked = await api(port, "/api/admin/export-key/revoke", { method: "POST", token: ownerTok, body: {} });
  check("owner can revoke the key", revoked.status === 200 && revoked.data.configured === false);
  const afterRevoke = await api(port, `/api/export/standings.csv?key=${encodeURIComponent(key)}`);
  check("revoked key stops working", afterRevoke.status === 401);

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("owner desk has a Google Sheets panel", appJs.includes("Google Sheets") && appJs.includes("SHEETSKEYGEN") && appJs.includes("IMPORTDATA"));
  check("owner desk can revoke the sheets key", appJs.includes("SHEETSKEYREVOKE"));
  check("owner desk links the official staff spreadsheet", appJs.includes("1Frq5HEWdD_Dld8bIOCq0_CqH7BaTY_ikgIHzqYMMmLY") && appJs.includes("Open spreadsheet"));
} catch (err) {
  failures++;
  console.error("  FAIL - suite error:", err.message);
  if (stderr) console.error(stderr);
} finally {
  if (child.exitCode == null) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(r, 2000);
      child.on("exit", () => {
        clearTimeout(t);
        r();
      });
    });
  }
}

try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("sheets-export tests passed");
