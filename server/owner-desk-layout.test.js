// Owner desk order and collapsible boxes.
// Run: `node server/owner-desk-layout.test.js`
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

function startServer(dataDir, port) {
  const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {});
  child.stdout.on("data", () => {});
  return child;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || "cdp error"));
      else resolve(msg.result);
    });
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function waitForJson(url, child) {
  const deadline = Date.now() + 15000;
  let lastErr;
  while (Date.now() < deadline) {
    if (child && child.exitCode != null) throw new Error(`chrome exited early with ${child.exitCode}`);
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw lastErr || new Error(`timed out waiting for ${url}`);
}

async function evalValue(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "page eval failed");
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evalValue(cdp, expression);
    if (last) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for page: ${JSON.stringify(last)}`);
}

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
check("desk boxes use a collapsible summary", appJs.includes("function collapsiblePanel") && css.includes(".desk-box-summary::after"));
check("recent log stays nested in staff activity", appJs.includes('id: "staff-recent-log"') && appJs.includes('id: "staff-activity"'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-desk-layout-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const server = startServer(dir, port);
const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-desk-chrome-"));
const debugPort = 19000 + Math.floor(Math.random() * 2000);
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeDir}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);
chrome.stderr.on("data", () => {});
chrome.stdout.on("data", () => {});

try {
  await waitHealth(port, server);
  const login = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "jasonjackson@tshdartsleague.com", password: "owner123" },
  });
  check("owner can sign in", login.status === 200 && Boolean(login.data.token));
  if (!login.data.token) throw new Error("no token");

  const list = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`, chrome);
  const page = list.find((t) => t.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("chrome page target missing");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("chrome websocket failed")), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `sessionStorage.setItem("tsh_token", ${JSON.stringify(login.data.token)});`,
  });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/admin` });

  const layout = await waitFor(
    cdp,
    `(() => {
      const root = document.querySelector(".max-w-7xl");
      if (!root || !root.querySelector("h1")?.textContent.includes("Owner desk")) return null;
      const labels = [...root.children].map((el) => {
        const fold = el.getAttribute?.("data-desk-fold");
        if (fold) return fold;
        const title = el.querySelector("h2")?.textContent?.trim();
        return title || el.tagName;
      });
      const boxes = Object.fromEntries(
        [...root.querySelectorAll("details.desk-box")].map((el) => [el.getAttribute("data-desk-fold"), el.open])
      );
      const staff = root.querySelector('[data-desk-fold="staff-activity"]');
      const recent = staff?.querySelector('[data-desk-fold="staff-recent-log"]');
      const head = [...root.querySelectorAll("h2")].find((h) => h.textContent.trim() === "Head Admins");
      return {
        labels,
        boxes,
        recentInside: Boolean(recent),
        recentOpen: recent ? recent.open : null,
        headWrapped: Boolean(head?.closest("details.desk-box")),
        contactWrapped: Boolean([...root.querySelectorAll("h2")].find((h) => h.textContent.trim() === "Contact cards")?.closest("details.desk-box")),
      };
    })()`
  );

  const labels = layout.labels;
  const at = (name) => labels.indexOf(name);
  check("owners box is the first desk section", at("owners") >= 0 && at("owners") < at("Contact cards"));
  check("contact cards sit under owners", at("Contact cards") >= 0 && at("Contact cards") < at("post-announcement"));
  check("post announcement follows contact cards", at("post-announcement") >= 0 && at("post-announcement") < at("staff-activity"));
  check("post announcement is not left at the bottom", at("post-announcement") < at("pending-signups"));
  check("regions box follows staff activity", at("staff-activity") < at("regions"));
  check("division admins follow regions", at("regions") < at("division-admins"));
  check("pending sign-ups stay after match approval", at("Approve match stats") < at("pending-signups"));
  check("owners box starts collapsed", layout.boxes.owners === false);
  check("staff activity starts collapsed", layout.boxes["staff-activity"] === false);
  check("regions box starts collapsed", layout.boxes.regions === false);
  check("division admins start collapsed", layout.boxes["division-admins"] === false);
  check("pending sign-ups start collapsed", layout.boxes["pending-signups"] === false);
  check("post announcement starts collapsed", layout.boxes["post-announcement"] === false);
  check("recent log is inside staff activity and starts collapsed", layout.recentInside && layout.recentOpen === false);
  check("contact cards stay open", layout.contactWrapped === false);
  check("head admins stay open", layout.headWrapped === false);

  const toggled = await evalValue(
    cdp,
    `(() => {
      const owners = document.querySelector('[data-desk-fold="owners"]');
      owners.querySelector("summary").click();
      const staff = document.querySelector('[data-desk-fold="staff-activity"]');
      staff.querySelector("summary").click();
      const recent = staff.querySelector('[data-desk-fold="staff-recent-log"]');
      recent.querySelector("summary").click();
      const regions = document.querySelector('[data-desk-fold="regions"]');
      regions.querySelector("summary").click();
      return {
        owners: owners.open,
        staff: staff.open,
        recent: recent.open,
        recentParent: recent.closest('[data-desk-fold="staff-activity"]') === staff,
        regions: regions.open,
        ownersBodyHiddenBefore: false,
      };
    })()`
  );
  check("owners box opens from its header", toggled.owners === true);
  check("staff activity opens from its header", toggled.staff === true);
  check("recent log opens inside staff activity", toggled.recent === true && toggled.recentParent === true);
  check("regions box opens from its header", toggled.regions === true);

  await evalValue(cdp, `window.dispatchEvent(new PopStateEvent("popstate"))`);
  const kept = await waitFor(
    cdp,
    `(() => {
      const root = document.querySelector(".max-w-7xl");
      const owners = root?.querySelector('[data-desk-fold="owners"]');
      const recent = root?.querySelector('[data-desk-fold="staff-recent-log"]');
      if (!owners || !root.querySelector("h1")?.textContent.includes("Owner desk")) return null;
      if (!owners.open || !recent?.open) return null;
      const ownersBody = owners.querySelector(".desk-box-body")?.textContent || "";
      const recentTitle = recent.querySelector(".structure-fold-title")?.textContent || "";
      return { owners: owners.open, recent: recent.open, ownersBody, recentTitle };
    })()`
  );
  check("open boxes stay open after the desk redraws", kept.owners === true && kept.recent === true);
  check(
    "owners box still contains owner actions",
    /MAKE OWNER|REMOVE OWNER|owner slots are filled/.test(kept.ownersBody)
  );
  check("recent log title is visible when opened", kept.recentTitle === "Recent log");

  const closed = await evalValue(
    cdp,
    `(() => {
      const owners = document.querySelector('[data-desk-fold="owners"]');
      owners.querySelector("summary").click();
      const body = owners.querySelector(".desk-box-body");
      const rect = body.getBoundingClientRect();
      const detailsH = owners.getBoundingClientRect().height;
      const summaryH = owners.querySelector("summary").getBoundingClientRect().height;
      return { open: owners.open, h: rect.height, detailsH, summaryH };
    })()`
  );
  check(
    "closing owners hides its body",
    closed.open === false && closed.h === 0 && closed.detailsH <= closed.summaryH + 4
  );

  ws.close();
} finally {
  server.kill("SIGTERM");
  chrome.kill("SIGTERM");
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nowner desk layout ok");
