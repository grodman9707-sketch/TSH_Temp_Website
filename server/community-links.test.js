// Messenger group links sit above Discord, and sign-up ends with a join-request step.
// Run: `node server/community-links.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EUROPE_HREF = "https://m.me/j/vlpYxGLbrtubBKI6/?send_source=gc%3Acopy_invite_link_c";
const AMERICAS_HREF = "https://m.me/j/0cIs92X7ME8Bhrbf/?send_source=gc%3Acopy_invite_link_c";

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-community-links-"));
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

  const content = await api(port, "/api/content");
  check("content ok", content.status === 200 && content.data.ok);
  const invites = content.data.league?.messengerInvites || [];
  check("two Messenger invites on the league", invites.length === 2);
  check("Europe Messenger URL", invites.some((m) => m.id === "europe" && m.href === EUROPE_HREF));
  check("Americas Messenger URL", invites.some((m) => m.id === "americas" && m.href === AMERICAS_HREF));

  const anonJoin = await api(port, "/api/account/community-join", { method: "POST", body: { requested: true } });
  check("community join requires login", anonJoin.status === 401);

  const registered = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Join Me",
      email: "join-me@test.com",
      password: "pass1234",
      regional: "both",
      dartcounterName: "JoinMeDC",
      avg: 44,
    },
  });
  check("register succeeds", registered.status === 200 && registered.data.ok);
  check("new account waits on chat join", registered.data.user?.communityJoinPending === true);
  const tok = registered.data.token;

  const mePending = await api(port, "/api/auth/me", { token: tok });
  check("me still pending until they request to join", mePending.data.user?.communityJoinPending === true);

  const done = await api(port, "/api/account/community-join", { method: "POST", token: tok, body: { requested: true } });
  check("join step can be completed", done.status === 200 && done.data.user?.communityJoinPending === false);
  const meDone = await api(port, "/api/auth/me", { token: tok });
  check("me is no longer pending after join", meDone.data.user?.communityJoinPending === false);

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  const homeChunk = appJs.slice(appJs.indexOf("Join Our Active Communities"), appJs.indexOf("Frequently Asked Questions"));
  const eu = homeChunk.indexOf("TSH Europe Messenger");
  const am = homeChunk.indexOf("TSH Americas Messenger");
  const discord = homeChunk.indexOf("League Discord");
  check("home lists both Messenger groups", eu >= 0 && am >= 0 && homeChunk.includes(EUROPE_HREF) && homeChunk.includes(AMERICAS_HREF));
  check("home Discord card sits below Messenger", discord > eu && discord > am);

  const navChunk = appJs.slice(appJs.indexOf("function communityNavLinks"), appJs.indexOf("function userLeagueIds"));
  check("sidebar lists Messenger before Discord", navChunk.includes("shortLabel") && navChunk.includes(">Discord</a>"));

  const joinChunk = appJs.slice(appJs.indexOf("function pageJoinCommunity"), appJs.indexOf("function pageSignUp"));
  check("signup last step asks them to request to be added", joinChunk.includes("request to be added") && joinChunk.includes("JOINCOMMUNITY"));
  check("signup last step includes Discord below Messenger", joinChunk.indexOf("League Discord") > joinChunk.indexOf("TSH Europe Messenger"));
  check("continue stays blocked until both Messenger links are opened", joinChunk.includes("Open both Messenger links"));

  const css = await (await fetch(`http://127.0.0.1:${port}/styles.css`)).text();
  check("Messenger mark styles are served", css.includes(".messenger-mark") && css.includes(".join-link-card"));
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
console.log("community-links tests passed");
