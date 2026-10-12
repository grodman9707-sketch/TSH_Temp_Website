// Phone number verification for match SMS. Codes stay on the user record.
// They are never included in publicUser or any HTTP response.

import crypto from "node:crypto";

export const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
export const PHONE_MAX_ATTEMPTS = 5;
export const PHONE_RESEND_MS = 60 * 1000;

export function normalizeE164(input) {
  const compact = String(input || "")
    .trim()
    .replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
    return { ok: false, error: "Enter a phone number in international format, like +447911123456" };
  }
  return { ok: true, phone: compact };
}

export function generatePhoneCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function codesMatch(stored, entered) {
  const a = Buffer.from(String(stored || ""));
  const b = Buffer.from(String(entered || "").trim());
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function issuePhoneVerification(user, phone, now = new Date(), code = generatePhoneCode()) {
  const sentAt = Date.parse(user.phoneVerifySentAt || "");
  if (Number.isFinite(sentAt) && now.getTime() - sentAt < PHONE_RESEND_MS) {
    const waitSec = Math.max(1, Math.ceil((PHONE_RESEND_MS - (now.getTime() - sentAt)) / 1000));
    return { ok: false, status: 429, error: `Wait ${waitSec} seconds before requesting another code` };
  }
  user.phone = phone;
  user.phoneVerifiedAt = null;
  user.phoneVerifyCode = code;
  user.phoneVerifyExpiresAt = new Date(now.getTime() + PHONE_CODE_TTL_MS).toISOString();
  user.phoneVerifyAttempts = 0;
  user.phoneVerifySentAt = now.toISOString();
  return { ok: true, code };
}

export function verifyPhoneCode(user, code, now = new Date()) {
  if (!user.phone || !user.phoneVerifyCode) {
    return { ok: false, error: "Request a new code first" };
  }
  const exp = Date.parse(user.phoneVerifyExpiresAt || "");
  if (!Number.isFinite(exp) || now.getTime() > exp) {
    return { ok: false, error: "That code has expired. Request a new one." };
  }
  const attempts = Number(user.phoneVerifyAttempts) || 0;
  if (attempts >= PHONE_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts. Request a new code." };
  }
  if (!codesMatch(user.phoneVerifyCode, code)) {
    user.phoneVerifyAttempts = attempts + 1;
    if (user.phoneVerifyAttempts >= PHONE_MAX_ATTEMPTS) {
      return { ok: false, error: "Too many attempts. Request a new code." };
    }
    return { ok: false, error: "That code is not right." };
  }
  user.phoneVerifiedAt = now.toISOString();
  delete user.phoneVerifyCode;
  delete user.phoneVerifyExpiresAt;
  delete user.phoneVerifyAttempts;
  return { ok: true };
}

export function clearPhone(user) {
  user.phone = "";
  user.phoneVerifiedAt = null;
  delete user.phoneVerifyCode;
  delete user.phoneVerifyExpiresAt;
  delete user.phoneVerifyAttempts;
  delete user.phoneVerifySentAt;
  if (!user.notifyPrefs || typeof user.notifyPrefs !== "object") user.notifyPrefs = {};
  user.notifyPrefs.sms = false;
}

export function blankAlertPrefs(email = true) {
  return { email: email !== false, sms: false, push: false };
}
