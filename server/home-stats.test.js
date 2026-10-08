// Landing page season numbers: highest average and highest checkout, with names.
// Run: `node server/home-stats.test.js`
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "page eval failed");
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
const numbersAt = appJs.indexOf("TSH In Numbers");
const numbersBlock = appJs.slice(numbersAt, numbersAt + 900);
check("180s box is replaced by Highest Average", numbersBlock.includes("Highest Average") && !numbersBlock.includes("Total 180s"));
check("checkout box is Highest Check Out", numbersBlock.includes("Highest Check Out"));
check("stat names use the gold single-line style", appJs.includes("home-stat-name") && css.includes(".home-stat-name") && css.includes("white-space: nowrap") && css.includes("color: #e8b425"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-home-stats-"));
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

const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-home-chrome-"));
const debugPort = 19000 + Math.floor(Math.random() * 2000);
const chrome = spawn(
  "google-chrome",
  ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeDir}`, "about:blank"],
  { stdio: ["ignore", "pipe", "pipe"] }
);
chrome.stderr.on("data", () => {});
chrome.stdout.on("data", () => {});

try {
  await waitHealth(port, child);
  const empty = await api(port, "/api/stats");
  check("empty season has no average leader", empty.status === 200 && empty.data.highestAverage === 0 && empty.data.highestAverageName === "");
  check("empty season has no checkout leader", empty.data.topCheckout === 0 && empty.data.highestCheckoutName === "");

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  const ownerTok = owner.data.token;
  const created = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: 3, name: "Numbers Division" },
  });
  const leagueId = created.data.league?.id;
  async function addPlayer(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const res = await api(port, "/api/auth/register", {
      method: "POST",
      body: { name, email: `${slug}-nums@test.com`, password: "pass1234", regional: "international", dartcounterName: `${slug}-nums`, avg: 40 },
    });
    await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: res.data.user.id, leagueId } });
    return res.data.user.id;
  }
  const longName = "Alexandria Worthington-Blake";
  const coName = "Christopher Montgomery";
  const ada = await addPlayer(longName);
  const bo = await addPlayer(coName);
  const made = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: ada, awayId: bo, week: 1, date: "2026-09-21", season: 1 },
  });
  const approved = await api(port, `/api/admin/fixtures/${made.data.fixture.id}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 2, homeAvg: 71.8, awayAvg: 64.2, homeCheckout: 120, awayCheckout: 164 },
  });
  check("result published", approved.status === 200);
  const after = await api(port, "/api/stats");
  check("highest average is the best match 3DA", after.data.highestAverage === 71.8 && after.data.highestAverageName === longName);
  check("highest checkout names the player who hit it", after.data.topCheckout === 164 && after.data.highestCheckoutName === coName);

  const list = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`, chrome);
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("chrome websocket failed")), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await waitFor(cdp, `document.body && document.body.textContent.includes("Highest Average") && document.body.textContent.includes(${JSON.stringify(longName)})`);

  const measure = `(width) => {
    const cards = [...document.querySelectorAll(".home-stat")];
    const card = (label) => cards.find((el) => el.textContent.includes(label));
    const read = (label) => {
      const el = card(label);
      const name = el?.querySelector(".home-stat-name");
      if (!name) return null;
      const style = getComputedStyle(name);
      const box = el.getBoundingClientRect();
      const nameBox = name.getBoundingClientRect();
      return {
        text: name.textContent,
        color: style.color,
        whiteSpace: style.whiteSpace,
        lines: name.getClientRects().length,
        fits: name.scrollWidth <= name.clientWidth + 1 && nameBox.right <= box.right + 1 && nameBox.left >= box.left - 1,
      };
    };
    return { width, average: read("Highest Average"), checkout: read("Highest Check Out"), has180s: document.body.textContent.includes("Total 180s") };
  }`;

  for (const width of [390, 1280]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
    await new Promise((r) => setTimeout(r, 200));
    const view = await evalValue(cdp, `(${measure})(${width})`);
    check(`${width}px highest average name is gold and on one line`, view.average?.text === longName && view.average.color === "rgb(232, 180, 37)" && view.average.whiteSpace === "nowrap" && view.average.lines === 1 && view.average.fits === true);
    check(`${width}px highest checkout name fits in gold`, view.checkout?.text === coName && view.checkout.color === "rgb(232, 180, 37)" && view.checkout.whiteSpace === "nowrap" && view.checkout.lines === 1 && view.checkout.fits === true);
    check(`${width}px landing page has no 180s box`, view.has180s === false);
  }
} catch (err) {
  failures++;
  console.error("  FAIL - suite error:", err.message);
  if (stderr) console.error(stderr);
} finally {
  chrome.kill("SIGTERM");
  if (child.exitCode == null) child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(chromeDir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll home stat checks passed.");
