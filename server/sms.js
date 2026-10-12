// SMS via the Twilio HTTP API. Node built-ins only (global fetch).
//
// Env:
//   TWILIO_ACCOUNT_SID   Account SID from the Twilio console
//   TWILIO_AUTH_TOKEN    Auth token from the Twilio console (never logged or returned)
//   TWILIO_FROM          E.164 Twilio number, for example +15005550006
//
// A From number is enough. If any of the three is missing, sendSms logs
// `[notify:dev] would sms …` and returns { ok: true, dev: true }.

export function smsConfigStatus() {
  const from = String(process.env.TWILIO_FROM || "").trim();
  const configured = Boolean(
    String(process.env.TWILIO_ACCOUNT_SID || "").trim() &&
      String(process.env.TWILIO_AUTH_TOKEN || "").trim() &&
      from
  );
  return { configured, from: configured ? from : "" };
}

export async function sendSms({ to, body }) {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = String(process.env.TWILIO_FROM || "").trim();
  const dest = String(to || "").trim();
  const text = String(body || "");
  if (!sid || !token || !from) {
    console.log(`[notify:dev] would sms ${dest} — "${text}"`);
    return { ok: true, dev: true };
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: dest, From: from, Body: text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Twilio ${res.status}: ${detail}`);
  }
  console.log(`[notify] sms ${dest}`);
  return { ok: true, dev: false };
}
