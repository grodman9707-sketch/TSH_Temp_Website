// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID ES256). Node crypto only.
//
// Env:
//   VAPID_PUBLIC_KEY    Uncompressed P-256 public key, base64url, 65 bytes (starts with 0x04)
//   VAPID_PRIVATE_KEY   Raw 32-byte P-256 private key, base64url (not PKCS8, not PEM)
//   VAPID_SUBJECT       mailto: contact. Defaults to mailto:Support@tshdartsleague.com
//                       only when both keys are set.
//
// Generate a matching pair with `node server/vapid-keys.js`. The private key
// is never written to the database or returned by the API.

import crypto from "node:crypto";

const DEFAULT_SUBJECT = "mailto:Support@tshdartsleague.com";
const RECORD_SIZE = 4096;
const VAPID_TTL_SEC = 12 * 60 * 60;

function b64urlToBuf(value) {
  const text = String(value || "").trim();
  if (!text) return Buffer.alloc(0);
  return Buffer.from(text, "base64url");
}

function pad32(buf) {
  const raw = Buffer.from(buf);
  if (raw.length === 32) return raw;
  if (raw.length > 32) return raw.subarray(raw.length - 32);
  return Buffer.concat([Buffer.alloc(32 - raw.length), raw]);
}

export function generateVapidKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: Buffer.from(ecdh.getPublicKey(null, "uncompressed")).toString("base64url"),
    privateKey: pad32(ecdh.getPrivateKey()).toString("base64url"),
  };
}

function readVapidEnv() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  const configured = Boolean(publicKey && privateKey);
  const subject = String(process.env.VAPID_SUBJECT || "").trim() || (configured ? DEFAULT_SUBJECT : "");
  return { publicKey, privateKey, configured, subject };
}

export function pushPublicStatus() {
  const env = readVapidEnv();
  return {
    configured: env.configured,
    publicKeySet: Boolean(env.publicKey),
    subject: env.configured ? env.subject : "",
  };
}

export function pushClientConfig() {
  const env = readVapidEnv();
  return {
    configured: env.configured,
    publicKey: env.configured ? env.publicKey : "",
  };
}

function keyPairFromRawPrivate(rawPrivate) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(pad32(rawPrivate));
  const publicKey = Buffer.from(ecdh.getPublicKey(null, "uncompressed"));
  const privateKey = crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: pad32(rawPrivate).toString("base64url"),
      x: publicKey.subarray(1, 33).toString("base64url"),
      y: publicKey.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  return { privateKey, publicKey };
}

function loadVapidKeys() {
  const env = readVapidEnv();
  if (!env.configured) {
    const err = new Error("VAPID keys are not configured");
    err.code = "VAPID_UNCONFIGURED";
    throw err;
  }
  const raw = b64urlToBuf(env.privateKey);
  if (raw.length !== 32) {
    throw new Error("VAPID_PRIVATE_KEY must be a base64url raw 32-byte P-256 private key");
  }
  const pair = keyPairFromRawPrivate(raw);
  const advertised = b64urlToBuf(env.publicKey);
  if (advertised.length !== 65 || advertised[0] !== 4 || !advertised.equals(pair.publicKey)) {
    throw new Error("VAPID_PUBLIC_KEY must be the uncompressed 65-byte key that matches VAPID_PRIVATE_KEY");
  }
  if (!env.subject) throw new Error("VAPID_SUBJECT is required");
  return { ...env, signingKey: pair.privateKey, publicRaw: pair.publicKey };
}

export function signVapidJwt({ audience, subject, privateKey, expiresInSec = VAPID_TTL_SEC, now = new Date() }) {
  const raw = Buffer.isBuffer(privateKey) ? privateKey : b64urlToBuf(privateKey);
  if (raw.length !== 32) throw new Error("VAPID private key must be 32 bytes");
  const signingKey = keyPairFromRawPrivate(raw).privateKey;
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
  const exp = Math.floor(now.getTime() / 1000) + expiresInSec;
  const claims = { aud: audience, exp, sub: subject };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  const sig = crypto.sign("sha256", Buffer.from(input), { key: signingKey, dsaEncoding: "ieee-p1363" });
  return { jwt: `${input}.${Buffer.from(sig).toString("base64url")}`, claims };
}

function xorNonce(base, index) {
  const nonce = Buffer.from(base);
  const seq = Buffer.alloc(12);
  seq.writeUInt32BE(index >>> 0, 8);
  for (let i = 0; i < nonce.length; i++) nonce[i] ^= seq[i];
  return nonce;
}

function derivePushKeys({ userPublicKey, authSecret, asPublic, sharedSecret, salt }) {
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), userPublicKey, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", sharedSecret, authSecret, info, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  return { cek, nonce };
}

function encryptRecords(cek, nonce, plaintext) {
  const maxChunk = RECORD_SIZE - 17;
  const parts = [];
  let offset = 0;
  let index = 0;
  do {
    const remaining = plaintext.length - offset;
    const last = remaining <= maxChunk;
    const take = last ? remaining : maxChunk;
    const chunk = plaintext.subarray(offset, offset + take);
    offset += take;
    const padded = Buffer.concat([chunk, Buffer.from([last ? 2 : 1])]);
    const cipher = crypto.createCipheriv("aes-128-gcm", cek, xorNonce(nonce, index));
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
    if (encrypted.length > RECORD_SIZE) throw new Error("Encrypted push record exceeds the record size");
    parts.push(encrypted);
    index += 1;
    if (last) break;
  } while (offset < plaintext.length);
  return Buffer.concat(parts);
}

function unpadRecord(padded, last) {
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end -= 1;
  if (end === 0) throw new Error("Push record is missing its padding delimiter");
  const delimiter = padded[end - 1];
  const expected = last ? 2 : 1;
  if (delimiter !== expected) throw new Error("Push record padding delimiter is wrong");
  return padded.subarray(0, end - 1);
}

export function encryptPushPayload({ userPublicKey, authSecret, plaintext, salt, localPrivateKey, localPublicKey }) {
  const uaPublic = Buffer.isBuffer(userPublicKey) ? Buffer.from(userPublicKey) : b64urlToBuf(userPublicKey);
  const auth = Buffer.isBuffer(authSecret) ? Buffer.from(authSecret) : b64urlToBuf(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("Subscription p256dh key must be a 65-byte uncompressed P-256 point");
  if (auth.length !== 16) throw new Error("Subscription auth secret must be 16 bytes");
  const ecdh = crypto.createECDH("prime256v1");
  if (localPrivateKey) ecdh.setPrivateKey(pad32(localPrivateKey));
  else ecdh.generateKeys();
  const asPublic = localPublicKey ? Buffer.from(localPublicKey) : Buffer.from(ecdh.getPublicKey(null, "uncompressed"));
  const shared = ecdh.computeSecret(uaPublic);
  const saltBuf = salt ? Buffer.from(salt) : crypto.randomBytes(16);
  if (saltBuf.length !== 16) throw new Error("Push salt must be 16 bytes");
  const { cek, nonce } = derivePushKeys({
    userPublicKey: uaPublic,
    authSecret: auth,
    asPublic,
    sharedSecret: shared,
    salt: saltBuf,
  });
  const body = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext));
  const records = encryptRecords(cek, nonce, body);
  const header = Buffer.concat([
    saltBuf,
    Buffer.from([(RECORD_SIZE >>> 24) & 255, (RECORD_SIZE >>> 16) & 255, (RECORD_SIZE >>> 8) & 255, RECORD_SIZE & 255]),
    Buffer.from([asPublic.length]),
    asPublic,
  ]);
  return Buffer.concat([header, records]);
}

export function decryptPushPayload({ userPrivateKey, authSecret, message }) {
  const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
  if (buf.length < 21 + 65) throw new Error("Push message is too short");
  const salt = buf.subarray(0, 16);
  const rs = buf.readUInt32BE(16);
  const idlen = buf[20];
  if (idlen !== 65 || buf.length < 21 + idlen + 16) throw new Error("Push message header is invalid");
  const asPublic = buf.subarray(21, 21 + idlen);
  const body = buf.subarray(21 + idlen);
  const ua = crypto.createECDH("prime256v1");
  ua.setPrivateKey(pad32(userPrivateKey));
  const uaPublic = Buffer.from(ua.getPublicKey(null, "uncompressed"));
  const shared = ua.computeSecret(asPublic);
  const auth = Buffer.isBuffer(authSecret) ? Buffer.from(authSecret) : b64urlToBuf(authSecret);
  const { cek, nonce } = derivePushKeys({
    userPublicKey: uaPublic,
    authSecret: auth,
    asPublic,
    sharedSecret: shared,
    salt,
  });
  const chunks = [];
  let offset = 0;
  let index = 0;
  while (offset < body.length) {
    const record = body.subarray(offset, Math.min(offset + rs, body.length));
    offset += record.length;
    if (record.length < 17) throw new Error("Push record is truncated");
    const last = offset >= body.length;
    const tag = record.subarray(record.length - 16);
    const data = record.subarray(0, record.length - 16);
    const decipher = crypto.createDecipheriv("aes-128-gcm", cek, xorNonce(nonce, index));
    decipher.setAuthTag(tag);
    const padded = Buffer.concat([decipher.update(data), decipher.final()]);
    chunks.push(unpadRecord(padded, last));
    index += 1;
  }
  return Buffer.concat(chunks);
}

export function parsePushSubscription(body) {
  const endpoint = String(body?.endpoint || "").trim();
  const p256dh = String(body?.keys?.p256dh || "").trim();
  const auth = String(body?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) return { error: "Subscription endpoint and keys are required" };
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { error: "Subscription endpoint is invalid" };
  }
  if (url.protocol !== "https:") return { error: "Subscription endpoint must be https" };
  if (endpoint.length > 4096) return { error: "Subscription endpoint is too long" };
  const pub = b64urlToBuf(p256dh);
  const secret = b64urlToBuf(auth);
  if (pub.length !== 65 || pub[0] !== 4) return { error: "Subscription p256dh key is invalid" };
  if (secret.length !== 16) return { error: "Subscription auth secret is invalid" };
  return { endpoint, keys: { p256dh, auth } };
}

export function upsertPushSubscription(user, subscription, now = new Date()) {
  if (!Array.isArray(user.pushSubscriptions)) user.pushSubscriptions = [];
  const next = {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    createdAt: now.toISOString(),
  };
  const existing = user.pushSubscriptions.find((item) => item.endpoint === next.endpoint);
  if (existing) {
    existing.keys = next.keys;
    existing.createdAt = next.createdAt;
  } else {
    user.pushSubscriptions.push(next);
  }
  if (!user.notifyPrefs || typeof user.notifyPrefs !== "object") user.notifyPrefs = {};
  user.notifyPrefs.push = true;
}

export function removePushSubscription(user, endpoint) {
  const target = String(endpoint || "").trim();
  if (!Array.isArray(user.pushSubscriptions)) user.pushSubscriptions = [];
  const before = user.pushSubscriptions.length;
  if (target) user.pushSubscriptions = user.pushSubscriptions.filter((item) => item.endpoint !== target);
  return before !== user.pushSubscriptions.length;
}

export async function sendWebPush(subscription, payload, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  const env = readVapidEnv();
  if (!env.configured) {
    console.log(`[notify:dev] would push ${subscription?.endpoint || ""} — ${text}`);
    return { ok: true, dev: true, gone: false };
  }
  const keys = loadVapidKeys();
  const endpoint = String(subscription?.endpoint || "");
  let origin;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    throw new Error("Push subscription endpoint is invalid");
  }
  const { jwt } = signVapidJwt({
    audience: origin,
    subject: keys.subject,
    privateKey: b64urlToBuf(keys.privateKey),
  });
  const body = encryptPushPayload({
    userPublicKey: subscription.keys.p256dh,
    authSecret: subscription.keys.auth,
    plaintext: text,
  });
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Authorization: `vapid t=${jwt},k=${keys.publicKey}`,
    },
    body,
  });
  if (res.status === 404 || res.status === 410) {
    return { ok: false, dev: false, gone: true, status: res.status };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Push ${res.status}: ${detail}`);
  }
  console.log(`[notify] push ${origin}`);
  return { ok: true, dev: false, gone: false, status: res.status };
}

export async function deliverPushMessage(msg, options = {}) {
  const subs = Array.isArray(msg?.subscriptions) ? msg.subscriptions : [];
  const gone = [];
  let dev = false;
  if (!subs.length) {
    const env = readVapidEnv();
    return { ok: true, dev: !env.configured, gone };
  }
  let sent = 0;
  let firstError = null;
  for (const sub of subs) {
    try {
      const result = await sendWebPush(sub, msg.payload, options);
      if (result.dev) dev = true;
      if (result.gone) gone.push(sub.endpoint);
      else if (result.ok) sent += 1;
    } catch (err) {
      firstError = err;
    }
  }
  if (!sent && !dev && gone.length === 0 && firstError) throw firstError;
  return { ok: true, dev, gone };
}
