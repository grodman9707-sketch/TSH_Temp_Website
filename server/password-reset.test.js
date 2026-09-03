// Password reset via emailed one-time code.
// Run: `node server/password-reset.test.js`
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

function readStore(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
}

function writeStore(dir, db) {
  fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify(db, null, 2));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-password-reset-"));
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

  const registered = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Pat Player",
      email: "pat.reset@test.com",
      password: "oldpass1",
      regional: "europe",
      dartcounterName: "PatResetDC",
      avg: 48,
    },
  });
  check("player can register", registered.status === 200 && registered.data.ok);
  const oldToken = registered.data.token;

  const missing = await api(port, "/api/auth/forgot-password", { method: "POST", body: {} });
  check("forgot-password requires email", missing.status === 400 && /email/i.test(missing.data.error || ""));

  const unknown = await api(port, "/api/auth/forgot-password", {
    method: "POST",
    body: { email: "nobody@test.com" },
  });
  check("unknown email still returns ok", unknown.status === 200 && unknown.data.ok);
  check("unknown email uses generic copy", /if that email is registered/i.test(unknown.data.message || ""));
  check("unknown email does not mint a code on any user", readStore(dir).users.every((u) => !u.passwordReset));

  const asked = await api(port, "/api/auth/forgot-password", {
    method: "POST",
    body: { email: "  PAT.reset@test.com  " },
  });
  check("known email returns the same generic ok", asked.status === 200 && asked.data.ok && asked.data.sent);
  check("response does not include the code", asked.data.code == null && asked.data.passwordReset == null);

  const afterAsk = readStore(dir);
  const pat = afterAsk.users.find((u) => String(u.email).toLowerCase() === "pat.reset@test.com");
  check("reset code stored on the account", Boolean(pat?.passwordReset?.code) && /^\d{6}$/.test(pat.passwordReset.code));
  check("reset code has an expiry", Number.isFinite(Date.parse(pat.passwordReset.expiresAt)));
  const code = pat.passwordReset.code;

  const oldLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "pat.reset@test.com", password: "oldpass1" },
  });
  check("old password still works until reset", oldLogin.status === 200 && oldLogin.data.ok);

  const me = await api(port, "/api/auth/me", { token: oldLogin.data.token });
  check("/me does not leak the reset code", me.status === 200 && me.data.user?.passwordReset == null && me.data.user?.password == null);

  const wrong = await api(port, "/api/auth/reset-password", {
    method: "POST",
    body: { email: "pat.reset@test.com", code: "000000", newPassword: "newpass1" },
  });
  check("wrong code is rejected", wrong.status === 400 && /invalid or expired/i.test(wrong.data.error || ""));

  const shortPw = await api(port, "/api/auth/reset-password", {
    method: "POST",
    body: { email: "pat.reset@test.com", code, newPassword: "123" },
  });
  check("short new password is rejected", shortPw.status === 400 && /at least 6/i.test(shortPw.data.error || ""));

  const expiredStore = readStore(dir);
  const expiredUser = expiredStore.users.find((u) => String(u.email).toLowerCase() === "pat.reset@test.com");
  const liveCode = expiredUser.passwordReset.code;
  expiredUser.passwordReset.expiresAt = new Date(Date.now() - 1000).toISOString();
  writeStore(dir, expiredStore);
  const expired = await api(port, "/api/auth/reset-password", {
    method: "POST",
    body: { email: "pat.reset@test.com", code: liveCode, newPassword: "newpass1" },
  });
  check("expired code is rejected", expired.status === 400 && /invalid or expired/i.test(expired.data.error || ""));

  const refreshed = await api(port, "/api/auth/forgot-password", {
    method: "POST",
    body: { email: "pat.reset@test.com" },
  });
  check("a new code can be requested", refreshed.status === 200 && refreshed.data.ok);
  const freshCode = readStore(dir).users.find((u) => String(u.email).toLowerCase() === "pat.reset@test.com").passwordReset
    .code;

  const reset = await api(port, "/api/auth/reset-password", {
    method: "POST",
    body: { email: "pat.reset@test.com", code: ` ${freshCode} `, newPassword: "newpass1" },
  });
  check("valid code sets the new password", reset.status === 200 && reset.data.ok && reset.data.token);
  check("reset signs the player in", reset.data.user?.email === "pat.reset@test.com");
  check("reset payload has no code leftover", reset.data.user?.passwordReset == null);

  const afterReset = readStore(dir).users.find((u) => String(u.email).toLowerCase() === "pat.reset@test.com");
  check("stored password is the new one", afterReset.password === "newpass1");
  check("used code is cleared", afterReset.passwordReset == null);

  const oldPw = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "pat.reset@test.com", password: "oldpass1" },
  });
  check("old password no longer works", oldPw.status === 401);

  const newPw = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "pat.reset@test.com", password: "newpass1" },
  });
  check("new password logs in", newPw.status === 200 && newPw.data.ok);

  const staleSession = await api(port, "/api/auth/me", { token: oldToken });
  check("sessions from before the reset are dropped", staleSession.status === 401);

  const reuse = await api(port, "/api/auth/reset-password", {
    method: "POST",
    body: { email: "pat.reset@test.com", code: freshCode, newPassword: "another1" },
  });
  check("used code cannot be reused", reuse.status === 400);

  const unknownReset = await api(port, "/api/auth/reset-password", {
    method: "POST",
    body: { email: "nobody@test.com", code: "123456", newPassword: "newpass1" },
  });
  check("unknown email reset uses the same error", unknownReset.status === 400 && /invalid or expired/i.test(unknownReset.data.error || ""));

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  check("sign-in page links to forgot password", appJs.includes('href="/forgot-password"') && appJs.includes("Forgot password?"));
  check("forgot-password route is wired", appJs.includes('q === "/forgot-password"') && appJs.includes("pageForgotPassword"));
  check("reset forms post to the new endpoints", appJs.includes("/api/auth/forgot-password") && appJs.includes("/api/auth/reset-password"));
  check("cache-bust query is bumped", indexHtml.includes("app.js?v=35") && indexHtml.includes("styles.css?v=35"));
} finally {
  child.kill("SIGTERM");
}

if (failures) {
  if (stderr.trim()) console.error(stderr.trim());
  process.exit(1);
}
console.log("password-reset tests passed");
