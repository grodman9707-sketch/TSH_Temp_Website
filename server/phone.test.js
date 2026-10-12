// Phone number validation and verification codes.
// Run: `node server/phone.test.js`
import { clearPhone, issuePhoneVerification, normalizeE164, verifyPhoneCode, PHONE_MAX_ATTEMPTS } from "./phone.js";

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

check("accepts the sample UK mobile number", normalizeE164("+447911123456").phone === "+447911123456");
check("strips spaces and dashes", normalizeE164(" +44 7911-123456 ").phone === "+447911123456");
check("rejects a local number without a plus", !normalizeE164("07911123456").ok);
check("rejects a too-short number", !normalizeE164("+12345").ok);
check("rejects a leading zero country code", !normalizeE164("+047911123456").ok);

const now = new Date("2026-08-20T12:00:00.000Z");
const user = { id: 1, notifyPrefs: { sms: true } };
const issued = issuePhoneVerification(user, "+447911123456", now, "123456");
check("issue stores a 6-digit code and clears verification", issued.ok && user.phone === "+447911123456" && user.phoneVerifyCode === "123456" && user.phoneVerifiedAt === null);
check("code expires in 10 minutes", Date.parse(user.phoneVerifyExpiresAt) - now.getTime() === 10 * 60 * 1000);
const resent = issuePhoneVerification(user, "+447911123456", new Date(now.getTime() + 30 * 1000), "654321");
check("resend inside 60 seconds is rejected and keeps the first code", !resent.ok && resent.status === 429 && user.phoneVerifyCode === "123456");

const wrong = verifyPhoneCode(user, "000000", now);
check("wrong code is rejected and counts an attempt", !wrong.ok && /not right/i.test(wrong.error) && user.phoneVerifyAttempts === 1 && user.phoneVerifiedAt === null);
user.phoneVerifyAttempts = PHONE_MAX_ATTEMPTS - 1;
const limited = verifyPhoneCode(user, "000000", now);
check("the last wrong code asks for a new code", !limited.ok && /too many attempts/i.test(limited.error) && user.phoneVerifyAttempts === PHONE_MAX_ATTEMPTS);
const blocked = verifyPhoneCode(user, "123456", now);
check("a later try is blocked even with the right code", !blocked.ok && /too many attempts/i.test(blocked.error) && user.phoneVerifiedAt === null);

user.phoneVerifyAttempts = 0;
user.phoneVerifyExpiresAt = new Date(now.getTime() - 1000).toISOString();
const expired = verifyPhoneCode(user, "123456", now);
check("expired code is rejected", !expired.ok && /expired/i.test(expired.error) && user.phoneVerifiedAt === null);

user.phoneVerifyExpiresAt = new Date(now.getTime() + 60 * 1000).toISOString();
const ok = verifyPhoneCode(user, " 123456 ", now);
check("right code verifies and deletes the secret", ok.ok && user.phoneVerifiedAt === now.toISOString() && user.phoneVerifyCode == null && user.phoneVerifyExpiresAt == null);

clearPhone(user);
check("remove clears the number and turns SMS off", user.phone === "" && user.phoneVerifiedAt === null && user.notifyPrefs.sms === false && user.phoneVerifySentAt == null);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll phone checks passed.");
