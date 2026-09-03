// Owner Jason Jackson account: password owner123, created/repaired on migrate.
// Run: `node server/owner-accounts.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = path.join(root, "data", "db.json");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

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

function startServer(dataDir, port) {
  const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (buf) => {
    stderr += buf.toString();
  });
  return { child, stderr: () => stderr };
}

const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const seedJason = (seed.users || []).find((u) => String(u.name).toLowerCase() === "jason jackson");
check("seed includes Jason Jackson", Boolean(seedJason));
check("seed password is owner123", seedJason?.password === "owner123");
check("seed role is owner", seedJason?.role === "owner");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-jason-owner-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const { child, stderr } = startServer(dir, port);

try {
  await waitHealth(port, child);

  const byEmail = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "jasonjackson@tshdartsleague.com", password: "owner123" },
  });
  check("Jason logs in with owner123", byEmail.status === 200 && byEmail.data.ok);
  check("Jason is an owner", byEmail.data.user?.role === "owner" && (byEmail.data.user?.roles || []).includes("owner"));
  check("Jason name is kept", byEmail.data.user?.name === "Jason Jackson");

  const byUser = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "JasonJackson", password: "owner123" },
  });
  check("Jason can sign in with username", byUser.status === 200 && byUser.data.ok);

  const wrong = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "jasonjackson@tshdartsleague.com", password: "Rodm@n85" },
  });
  check("Gordon's password does not open Jason's account", wrong.status === 401);

  const gordon = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("Gordon still logs in", gordon.status === 200 && gordon.data.ok);
} finally {
  child.kill("SIGTERM");
}

const repairDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-jason-repair-"));
const repairPort = 18000 + Math.floor(Math.random() * 2000);
const planted = JSON.parse(fs.readFileSync(seedPath, "utf8"));
planted.users = planted.users.filter((u) => String(u.name).toLowerCase() !== "jason jackson");
planted.users.push({
  id: 42,
  name: "Jason Jackson",
  email: "jason.live@example.com",
  username: "JJackson",
  password: "old-unknown",
  role: "player",
  roles: [],
  leagueId: null,
  leagueIds: [],
  adminLeagueId: null,
  adminLeagueIds: [],
  regionalChoice: "europe",
  regionalIds: [1],
  regionalId: 1,
  dartcounterName: "Jason jackson",
  nickname: "JJ",
  avg: 46,
});
fs.mkdirSync(repairDir, { recursive: true });
fs.writeFileSync(path.join(repairDir, "db.json"), JSON.stringify(planted, null, 2));
const repair = startServer(repairDir, repairPort);
try {
  await waitHealth(repairPort, repair.child);
  const oldPw = await api(repairPort, "/api/auth/login", {
    method: "POST",
    body: { email: "jason.live@example.com", password: "old-unknown" },
  });
  check("stale Jason password is replaced on startup", oldPw.status === 401);
  const fixed = await api(repairPort, "/api/auth/login", {
    method: "POST",
    body: { email: "jason.live@example.com", password: "owner123" },
  });
  check("existing Jason account is repaired to owner123", fixed.status === 200 && fixed.data.ok);
  check("existing Jason is promoted to owner", fixed.data.user?.role === "owner");
  check("existing Jason keeps his email", fixed.data.user?.email === "jason.live@example.com");
} finally {
  repair.child.kill("SIGTERM");
}

if (failures) {
  const extra = `${stderr()}\n${repair.stderr()}`.trim();
  if (extra) console.error(extra);
  process.exit(1);
}
console.log("owner-accounts tests passed");
