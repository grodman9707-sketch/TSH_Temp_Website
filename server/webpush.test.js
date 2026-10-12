// Web Push encryption and VAPID. Run: `node server/webpush.test.js`
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alertsConfigStatus } from "./notifications.js";
import {
  decryptPushPayload,
  encryptPushPayload,
  generateVapidKeys,
  sendWebPush,
  signVapidJwt,
} from "./webpush.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const saved = {
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM: process.env.TWILIO_FROM,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

const keys = generateVapidKeys();
check("generated public key is 65 uncompressed bytes", Buffer.from(keys.publicKey, "base64url").length === 65 && Buffer.from(keys.publicKey, "base64url")[0] === 4);
check("generated private key is 32 raw bytes", Buffer.from(keys.privateKey, "base64url").length === 32);

const ua = crypto.createECDH("prime256v1");
ua.generateKeys();
const auth = crypto.randomBytes(16);
const payload = JSON.stringify({ title: "TSH", body: "Week 3 vs Sam", url: "/my-matches" });
const encrypted = encryptPushPayload({
  userPublicKey: ua.getPublicKey(),
  authSecret: auth,
  plaintext: payload,
});
const decrypted = decryptPushPayload({
  userPrivateKey: ua.getPrivateKey(),
  authSecret: auth,
  message: encrypted,
});
check("aes128gcm round-trip recovers the payload", decrypted.toString("utf8") === payload);

const now = new Date("2026-08-20T12:00:00.000Z");
const signed = signVapidJwt({
  audience: "https://fcm.googleapis.com",
  subject: "mailto:Support@tshdartsleague.com",
  privateKey: keys.privateKey,
  now,
});
const claims = JSON.parse(Buffer.from(signed.jwt.split(".")[1], "base64url").toString("utf8"));
check("VAPID aud is the push origin", claims.aud === "https://fcm.googleapis.com");
check("VAPID sub is the mailto contact", claims.sub === "mailto:Support@tshdartsleague.com");
check("VAPID exp is 12 hours ahead", claims.exp === Math.floor(now.getTime() / 1000) + 12 * 60 * 60);
const pub = Buffer.from(keys.publicKey, "base64url");
const verifyKey = crypto.createPublicKey({
  key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") },
  format: "jwk",
});
const [h, p, s] = signed.jwt.split(".");
check(
  "VAPID JWT signature verifies with the public key",
  crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: verifyKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))
);

const endpoint = "https://push.example.test/sub/player";
const calls = [];
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = "mailto:alerts@example.com";
const sent = await sendWebPush(
  { endpoint, keys: { p256dh: Buffer.from(ua.getPublicKey()).toString("base64url"), auth: auth.toString("base64url") } },
  { title: "Hi", body: "There", url: "/my-matches" },
  {
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return new Response("", { status: 201 });
    },
  }
);
check("send posts the encrypted body", sent.ok && !sent.dev && calls.length === 1 && calls[0].url === endpoint);
const headers = calls[0].opts.headers;
check("request uses aes128gcm and a 1-day TTL", headers["Content-Encoding"] === "aes128gcm" && String(headers.TTL) === "86400");
check("authorization is a vapid token plus the public key", headers.Authorization.startsWith("vapid t=") && headers.Authorization.endsWith(`,k=${keys.publicKey}`));
const jwt = headers.Authorization.slice("vapid t=".length).split(",k=")[0];
const sentClaims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
check("sent VAPID aud is the endpoint origin", sentClaims.aud === "https://push.example.test" && sentClaims.sub === "mailto:alerts@example.com");
const opened = decryptPushPayload({
  userPrivateKey: ua.getPrivateKey(),
  authSecret: auth,
  message: calls[0].opts.body,
});
check("push service can decrypt the JSON payload", opened.toString("utf8") === JSON.stringify({ title: "Hi", body: "There", url: "/my-matches" }));

const gone = await sendWebPush(
  { endpoint, keys: { p256dh: Buffer.from(ua.getPublicKey()).toString("base64url"), auth: auth.toString("base64url") } },
  { title: "x", body: "y", url: "/my-matches" },
  { fetchImpl: async () => new Response("", { status: 410 }) }
);
check("410 marks the subscription gone", gone.gone === true && gone.ok === false);

delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;
let fetched = false;
const dev = await sendWebPush(
  { endpoint, keys: { p256dh: "aa", auth: "bb" } },
  { title: "x" },
  { fetchImpl: async () => { fetched = true; return new Response("", { status: 201 }); } }
);
check("missing VAPID keys log instead of sending", dev.ok && dev.dev && fetched === false);

process.env.TWILIO_ACCOUNT_SID = "ACexample";
process.env.TWILIO_AUTH_TOKEN = "token-should-not-leak";
process.env.TWILIO_FROM = "+15005550006";
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
const cfg = alertsConfigStatus();
const dumped = JSON.stringify(cfg);
check("admin status reports SMS and push as configured", cfg.sms.configured === true && cfg.sms.from === "+15005550006" && cfg.push.configured === true && cfg.push.publicKeySet === true);
check("admin status never includes the Twilio token or VAPID private key", !dumped.includes("token-should-not-leak") && !dumped.includes(keys.privateKey) && !("privateKey" in cfg.push));
restoreEnv();

const cli = spawnSync(process.execPath, [path.join(root, "server/vapid-keys.js")], { encoding: "utf8" });
check("vapid-keys CLI exits cleanly", cli.status === 0);
check("vapid-keys CLI prints the three env lines", /VAPID_PUBLIC_KEY=\S+/.test(cli.stdout) && /VAPID_PRIVATE_KEY=\S+/.test(cli.stdout) && /VAPID_SUBJECT=mailto:/.test(cli.stdout));

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll web push checks passed.");
