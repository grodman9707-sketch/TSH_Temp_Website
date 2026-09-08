// Off-site Postgres snapshots + Airtable spreadsheet mapping.
// Run: `node server/offsite.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { airtableConfigured, airtableFixtureRecords, airtablePlayerRecords, AIRTABLE_TABLES, syncAirtable } from "./airtableSync.js";
import { snapshotPayload } from "./postgresBackup.js";
import { offsiteConfigured, offsiteStatus, runOffsiteSync } from "./offsite.js";

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
  applications: [],
  leagueRequests: [],
  announcements: [],
  adminProfiles: [],
  approvals: [],
};

const snap = snapshotPayload(db);
check("postgres snapshot keeps the password so a restore can log people in", snap.users[0].password === "secret-pass");
check("postgres snapshot is a clone", snap.users[0] !== db.users[0]);

const players = airtablePlayerRecords(db);
check("airtable has the player", players[0].fields.Name === "Pat Player");
check("airtable never includes a password field", !("password" in players[0].fields) && !JSON.stringify(players).includes("secret-pass"));
check("airtable never includes reset codes", !JSON.stringify(players).includes("123456"));
check("airtable email is present for staff", players[0].fields.Email === "pat@test.com");
check("airtable player key is stable", players[0].fields["Player Key"] === "9");

const fixtures = airtableFixtureRecords(db);
check("airtable fixture score is filled for played matches", fixtures[0].fields.Score === "5–2");
check("airtable tables cover players standings fixtures", AIRTABLE_TABLES.map((t) => t.name).join(",") === "Players,Standings,Fixtures");

check("offsite is off without env", offsiteConfigured() === false);
check("status reports unconfigured postgres", offsiteStatus().postgres.configured === false);
check("status reports unconfigured airtable", airtableConfigured() === false);

const skipped = await runOffsiteSync(db, { source: "manual" });
check("run without config reports the gap", skipped.errors.some((e) => /Neither DATABASE_URL nor Airtable/i.test(e)));

const calls = [];
async function fakeFetch(url, opts = {}) {
  calls.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
  if (String(url).includes("/meta/bases/") && (opts.method || "GET") === "GET") {
    return {
      ok: true,
      json: async () => ({ tables: [] }),
    };
  }
  if (String(url).includes("/meta/bases/") && opts.method === "POST") {
    return { ok: true, json: async () => ({ id: "tbl", name: JSON.parse(opts.body).name }) };
  }
  if (opts.method === "PATCH") {
    return { ok: true, json: async () => ({ records: [], createdRecords: [], updatedRecords: [] }) };
  }
  if ((opts.method || "GET") === "GET") {
    return { ok: true, json: async () => ({ records: [] }) };
  }
  if (opts.method === "DELETE") {
    return { ok: true, json: async () => ({ records: [] }) };
  }
  return { ok: true, json: async () => ({}) };
}

process.env.AIRTABLE_TOKEN = "patTEST";
process.env.AIRTABLE_BASE_ID = "appTESTBASE";
check("airtable looks configured with env", airtableConfigured() === true);
await syncAirtable(db, { fetchImpl: fakeFetch });
check("airtable creates the three tables", calls.filter((c) => c.method === "POST" && /\/tables$/.test(c.url)).length === 3);
check("airtable upserts players", calls.some((c) => c.method === "PATCH" && c.body?.performUpsert?.fieldsToMergeOn?.includes("Player Key")));
check("airtable upserts never send passwords", !JSON.stringify(calls).includes("secret-pass"));
delete process.env.AIRTABLE_TOKEN;
delete process.env.AIRTABLE_BASE_ID;

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

async function api(port, pathname, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-offsite-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: "", AIRTABLE_TOKEN: "", AIRTABLE_BASE_ID: "" },
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
      name: "Offsite Player",
      email: "offsite@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "OffsiteDC",
      avg: 44,
    },
  });
  check("register player", player.status === 200 && player.data.token);

  const denied = await api(port, "/api/admin/backup", { token: player.data.token });
  check("players cannot read backup status", denied.status === 403);

  const status = await api(port, "/api/admin/backup", { token: ownerTok });
  check("owner can read backup status", status.status === 200);
  check("postgres is reported off", status.data.postgres?.configured === false);
  check("airtable is reported off", status.data.airtable?.configured === false);

  const run = await api(port, "/api/admin/backup/run", { method: "POST", token: ownerTok, body: {} });
  check("manual sync without config fails clearly", run.status === 400 && (run.data.errors || []).length > 0);

  const restore = await api(port, "/api/admin/backup/restore", { method: "POST", token: ownerTok, body: { id: 1 } });
  check("restore without postgres is blocked", restore.status === 400);

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  check("overview flags backup as unconfigured", overview.data.backup?.postgresConfigured === false && overview.data.backup?.airtableConfigured === false);

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("owner desk has backup panel", appJs.includes("Off-site backup") && appJs.includes("OFFSITEBACKUP") && appJs.includes("AIRTABLE_BASE_ID"));
  check("owner desk can restore snapshots", appJs.includes("OFFSITERESTORE"));
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
console.log("offsite tests passed");
