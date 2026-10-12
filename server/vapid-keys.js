// Print a new VAPID key pair for Web Push. Run: node server/vapid-keys.js
//
// VAPID_PUBLIC_KEY  is the uncompressed P-256 public key (65 bytes, base64url).
// VAPID_PRIVATE_KEY is the raw 32-byte P-256 private key (base64url), not PKCS8.
// VAPID_SUBJECT     is a mailto: contact address. Set it on the server as well.
//
// Do not commit the private key or put it in data/db.json.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateVapidKeys } from "./webpush.js";

function printKeys() {
  const keys = generateVapidKeys();
  console.log("Add these three variables on the server (Railway → web service → Variables), then redeploy.");
  console.log("VAPID_PRIVATE_KEY is a raw 32-byte P-256 private key, base64url. It must stay off git and out of the database.");
  console.log("");
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log("VAPID_SUBJECT=mailto:Support@tshdartsleague.com");
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) printKeys();
