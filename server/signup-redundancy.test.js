// Sign-up redundancy: one account per player, unique email / username / DartCounter, no duplicate applications.
// Run: `node server/signup-redundancy.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-signup-redundancy-"));
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

  const first = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Pat Player",
      email: "  pat@test.com  ",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "PatDC",
      avg: 48,
    },
  });
  check("first registration succeeds", first.status === 200 && first.data.ok);
  check("pending flag on new user", first.data.user?.hasPendingApplication === true);
  check("not fully placed yet", first.data.user?.fullyPlaced === false);
  const patTok = first.data.token;

  const dupEmail = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Pat Clone",
      email: "PAT@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "OtherDC",
      avg: 40,
    },
  });
  check("duplicate email is rejected", dupEmail.status === 400 && /already registered/i.test(dupEmail.data.error || ""));

  const dupDc = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Pat Clone",
      email: "pat-clone@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "patdc",
      avg: 40,
    },
  });
  check("duplicate DartCounter name is rejected", dupDc.status === 400 && /DartCounter name is already registered/i.test(dupDc.data.error || ""));

  const emailCheck = await api(port, "/api/auth/check-signup", {
    method: "POST",
    body: { email: "pat@test.com" },
  });
  check("check-signup flags taken email", emailCheck.status === 400 && /already registered/i.test(emailCheck.data.error || ""));

  const dcCheck = await api(port, "/api/auth/check-signup", {
    method: "POST",
    body: { dartcounterName: "PatDC" },
  });
  check("check-signup flags taken DartCounter name", dcCheck.status === 400 && /DartCounter/i.test(dcCheck.data.error || ""));

  const freeCheck = await api(port, "/api/auth/check-signup", {
    method: "POST",
    body: { email: "fresh@test.com", dartcounterName: "FreshDC" },
  });
  check("check-signup allows unused identity", freeCheck.status === 200 && freeCheck.data.available === true);

  const secondApply = await api(port, "/api/apply", {
    method: "POST",
    token: patTok,
    body: { regionalId: 1, dartcounterName: "PatDC2", avg: 51 },
  });
  check("second application while pending is rejected", secondApply.status === 400 && /pending application/i.test(secondApply.data.error || ""));

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const place = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: first.data.user.id, leagueId: 1 },
  });
  check("place first player", place.status === 200 && place.data.fullyPlaced === true);

  const applyAfterPlace = await api(port, "/api/apply", {
    method: "POST",
    token: patTok,
    body: { regionalId: 1, dartcounterName: "PatDC2", avg: 51 },
  });
  check("application after placement is rejected", applyAfterPlace.status === 400 && /already placed/i.test(applyAfterPlace.data.error || ""));

  const second = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Sam Player",
      email: "sam-unique@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "SamDC",
      username: "sammy",
      avg: 44,
    },
  });
  check("second distinct player registers", second.status === 200 && second.data.ok);

  const dupUser = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Sam Clone",
      email: "sam-clone@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "SamCloneDC",
      username: "Sammy",
      avg: 41,
    },
  });
  check("duplicate username is rejected", dupUser.status === 400 && /username is already in use/i.test(dupUser.data.error || ""));

  const emailAsUser = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Sam Clone",
      email: "sam-clone@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "SamCloneDC",
      username: "pat@test.com",
      avg: 41,
    },
  });
  check("username matching another email is rejected", emailAsUser.status === 400 && /matches an existing account email/i.test(emailAsUser.data.error || ""));

  const stealDc = await api(port, "/api/account/profile", {
    method: "POST",
    token: second.data.token,
    body: { name: "Sam Player", dartcounterName: "PatDC" },
  });
  check("profile cannot steal another DartCounter name", stealDc.status === 400 && /DartCounter name is already registered/i.test(stealDc.data.error || ""));

  const adminDup = await api(port, "/api/admin/create-player", {
    method: "POST",
    token: ownerTok,
    body: {
      name: "Admin Clone",
      email: "pat@test.com",
      password: "pass1234",
      dartcounterName: "AdminCloneDC",
    },
  });
  check("admin create-player rejects duplicate email", adminDup.status === 400 && /already registered/i.test(adminDup.data.error || ""));

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("signup form checks identity before continuing", appJs.includes("/api/auth/check-signup"));
  check("apply page blocks a pending player", appJs.includes("Application already received") && appJs.includes("hasPendingApplication"));
  check("signed-in users cannot open sign-up again", appJs.includes("You already have an account"));
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
console.log("signup redundancy tests passed");
