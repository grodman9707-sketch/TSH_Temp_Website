// Phone, SMS, and Web Push account routes. Uses a temp data dir.
// Run: `node server/phone-alerts.test.js`
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "public/manifest.json"), "utf8"));
const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
check("dashboard keeps the email checkbox and adds the text checkbox", appJs.includes("Email me about upcoming matches and arrange-chat messages") && appJs.includes("Text me about upcoming matches and arrange-chat messages"));
check("dashboard explains iPhone Home Screen alerts", appJs.includes("Share → Add to Home Screen") && appJs.includes("Enable alerts on this phone") && appJs.includes("Stop alerts on this phone"));
check("preferences post email, sms, and push", appJs.includes('JSON.stringify({ email: emailOn, sms: smsOn, push: pushOn })'));
check("admin desk can test email, text, and this phone", appJs.includes("SEND ME A TEST TEXT") && appJs.includes("SEND A TEST ALERT TO THIS PHONE") && appJs.includes("/api/admin/notifications/test-sms") && appJs.includes("/api/admin/notifications/test-push"));
check("manifest is standalone TSH Darts League", manifest.name === "TSH Darts League" && manifest.display === "standalone");
check("service worker handles push and notification clicks", sw.includes('addEventListener("push"') && sw.includes('addEventListener("notificationclick"') && sw.includes("/my-matches"));
check("homepage links the manifest", indexHtml.includes('rel="manifest"') && indexHtml.includes("/manifest.json"));

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-phone-alerts-"));
const port = 19000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: {
    ...process.env,
    DATA_DIR: dir,
    PORT: String(port),
    HOST: "127.0.0.1",
    EMAIL_API_KEY: "",
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "token-should-not-leak",
    TWILIO_FROM: "",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "private-key-should-not-leak",
    VAPID_SUBJECT: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (buf) => {
  stderr += buf.toString();
});
child.stdout.on("data", () => {});

const subscriptionKey = Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]);
const subscription = {
  endpoint: "https://push.example.test/subscription/phone-alerts",
  keys: {
    p256dh: subscriptionKey.toString("base64url"),
    auth: crypto.randomBytes(16).toString("base64url"),
  },
};

try {
  await waitHealth(port, child);
  const swRes = await fetch(`http://127.0.0.1:${port}/sw.js`);
  const manifestRes = await fetch(`http://127.0.0.1:${port}/manifest.json`);
  check("service worker and manifest are served", swRes.ok && manifestRes.ok && (await manifestRes.json()).display === "standalone");

  const anon = await api(port, "/api/account/phone", { method: "POST", body: { phone: "+447911123456" } });
  check("phone save requires login", anon.status === 401);

  const registered = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Phone Pat", email: "phone.pat@test.com", password: "secret1", regional: "international", dartcounterName: "PhonePatDC", avg: 50 },
  });
  check("player can register", registered.status === 200 && registered.data.token);
  const token = registered.data.token;
  const userId = registered.data.user.id;

  const bad = await api(port, "/api/account/phone", { method: "POST", token, body: { phone: "07911" } });
  check("bad phone is rejected", bad.status === 400 && /international format/i.test(bad.data.error || ""));

  const saved = await api(port, "/api/account/phone", { method: "POST", token, body: { phone: "+44 7911 123456" } });
  check("valid phone is stored unverified", saved.status === 200 && saved.data.user.phone === "+447911123456" && saved.data.user.phoneVerifiedAt == null && saved.data.dev === true);
  check("verify code is not in the HTTP response", saved.data.code == null && saved.data.user.phoneVerifyCode == null);
  const stored = readStore(dir).users.find((u) => u.id === userId);
  check("server stores a 6-digit code", /^\d{6}$/.test(stored.phoneVerifyCode || "") && Number.isFinite(Date.parse(stored.phoneVerifyExpiresAt)));

  const resent = await api(port, "/api/account/phone", { method: "POST", token, body: { phone: "+447911123456" } });
  check("immediate resend is rate limited", resent.status === 429);

  const wrong = await api(port, "/api/account/phone/verify", { method: "POST", token, body: { code: "000000" } });
  check("wrong code is rejected", wrong.status === 400 && /not right/i.test(wrong.data.error || ""));
  check("wrong code increments attempts", readStore(dir).users.find((u) => u.id === userId).phoneVerifyAttempts === 1);

  const limitedStore = readStore(dir);
  const limitedUser = limitedStore.users.find((u) => u.id === userId);
  limitedUser.phoneVerifyAttempts = 5;
  writeStore(dir, limitedStore);
  const limited = await api(port, "/api/account/phone/verify", { method: "POST", token, body: { code: limitedUser.phoneVerifyCode } });
  check("too many attempts requires a new code", limited.status === 400 && /too many/i.test(limited.data.error || ""));

  const expiredStore = readStore(dir);
  const expiredUser = expiredStore.users.find((u) => u.id === userId);
  expiredUser.phoneVerifyAttempts = 0;
  expiredUser.phoneVerifyExpiresAt = new Date(Date.now() - 1000).toISOString();
  const liveCode = expiredUser.phoneVerifyCode;
  writeStore(dir, expiredStore);
  const expired = await api(port, "/api/account/phone/verify", { method: "POST", token, body: { code: liveCode } });
  check("expired code is rejected", expired.status === 400 && /expired/i.test(expired.data.error || ""));

  const refreshStore = readStore(dir);
  const refreshUser = refreshStore.users.find((u) => u.id === userId);
  refreshUser.phoneVerifySentAt = new Date(Date.now() - 120 * 1000).toISOString();
  writeStore(dir, refreshStore);
  const refreshed = await api(port, "/api/account/phone", { method: "POST", token, body: { phone: "+447911123456" } });
  check("a new code can be requested after the wait", refreshed.status === 200 && refreshed.data.code == null);
  const fresh = readStore(dir).users.find((u) => u.id === userId);
  const verified = await api(port, "/api/account/phone/verify", { method: "POST", token, body: { code: fresh.phoneVerifyCode } });
  check("right code verifies the phone", verified.status === 200 && verified.data.user.phoneVerifiedAt && verified.data.user.phone === "+447911123456");
  const after = readStore(dir).users.find((u) => u.id === userId);
  check("verified account no longer stores the code", after.phoneVerifyCode == null && after.phoneVerifyExpiresAt == null);

  const prefs = await api(port, "/api/account/notifications", { method: "POST", token, body: { email: false, sms: true, push: true } });
  check("notification flags save independently", prefs.status === 200 && prefs.data.user.notifyPrefs.email === false && prefs.data.user.notifyPrefs.sms === true && prefs.data.user.notifyPrefs.push === true);

  const pushCfg = await api(port, "/api/account/push/config", { token });
  check("push config says alerts are not turned on", pushCfg.status === 200 && pushCfg.data.configured === false && !pushCfg.data.publicKey);

  const pushed = await api(port, "/api/account/push", { method: "POST", token, body: subscription });
  check("subscription is counted, not echoed", pushed.status === 200 && pushed.data.user.pushDeviceCount === 1 && pushed.data.user.notifyPrefs.push === true);
  const me = await api(port, "/api/auth/me", { token });
  const meJson = JSON.stringify(me.data);
  check("signed-in profile hides verification secrets and push keys", me.status === 200 && !("phoneVerifyCode" in (me.data.user || {})) && !meJson.includes(subscription.endpoint) && !meJson.includes(subscription.keys.p256dh) && !meJson.includes("token-should-not-leak"));

  const stranger = await api(port, `/api/player/${userId}`);
  check("public player page hides the phone number", stranger.status === 200 && stranger.data.player.phone === "" && !JSON.stringify(stranger.data).includes("+447911123456"));
  const selfPage = await api(port, `/api/player/${userId}`, { token });
  check("a player can still see their own number", selfPage.data.player.phone === "+447911123456");

  const removedPush = await api(port, "/api/account/push/remove", { method: "POST", token, body: { endpoint: subscription.endpoint } });
  check("this browser's subscription can be removed", removedPush.status === 200 && removedPush.data.user.pushDeviceCount === 0 && removedPush.data.user.notifyPrefs.push === true);

  const removed = await api(port, "/api/account/phone/remove", { method: "POST", token, body: {} });
  check("removing the phone turns texts off", removed.status === 200 && removed.data.user.phone === "" && removed.data.user.phoneVerifiedAt == null && removed.data.user.notifyPrefs.sms === false);

  const playerTest = await api(port, "/api/admin/notifications/test-sms", { method: "POST", token, body: {} });
  check("players cannot send the staff test text", playerTest.status === 403);

  const owner = await api(port, "/api/auth/login", { method: "POST", body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" } });
  check("owner can sign in", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;
  const cfg = await api(port, "/api/admin/notifications/config", { token: ownerTok });
  const cfgJson = JSON.stringify(cfg.data);
  check("admin config describes SMS and push without secrets", cfg.status === 200 && cfg.data.sms && cfg.data.sms.configured === false && cfg.data.push && cfg.data.push.publicKeySet === false && cfg.data.push.configured === false && !cfgJson.includes("token-should-not-leak") && !cfgJson.includes("private-key-should-not-leak"));
  const noPhone = await api(port, "/api/admin/notifications/test-sms", { method: "POST", token: ownerTok, body: {} });
  check("test text requires the owner's verified phone", noPhone.status === 400);
  const noPush = await api(port, "/api/admin/notifications/test-push", { method: "POST", token: ownerTok, body: { endpoint: subscription.endpoint } });
  check("test alert requires this browser to be registered", noPush.status === 400);

  const ownerStore = readStore(dir);
  const ownerUser = ownerStore.users.find((u) => u.id === owner.data.user.id);
  ownerUser.phone = "+447911123499";
  ownerUser.phoneVerifiedAt = new Date().toISOString();
  ownerUser.pushSubscriptions = [subscription];
  writeStore(dir, ownerStore);
  const testSms = await api(port, "/api/admin/notifications/test-sms", { method: "POST", token: ownerTok, body: {} });
  check("unconfigured Twilio logs the owner test text", testSms.status === 200 && testSms.data.ok && testSms.data.dev === true && !JSON.stringify(testSms.data).includes("token-should-not-leak"));
  const testPush = await api(port, "/api/admin/notifications/test-push", { method: "POST", token: ownerTok, body: { endpoint: subscription.endpoint } });
  check("unconfigured VAPID logs the owner test alert", testPush.status === 200 && testPush.data.ok && testPush.data.dev === true && !JSON.stringify(testPush.data).includes("private-key-should-not-leak"));
  if (stderr.includes("token-should-not-leak") || stderr.includes("private-key-should-not-leak")) {
    check("server logs do not print the Twilio token or VAPID private key", false);
  } else {
    check("server logs do not print the Twilio token or VAPID private key", true);
  }
} catch (err) {
  failures++;
  console.error(err);
} finally {
  child.kill("SIGTERM");
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll phone alert route checks passed.");
