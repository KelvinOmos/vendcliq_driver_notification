import { readFileSync, existsSync } from "fs";
import admin from "firebase-admin";

let initAttempted = false;
let configured = false;

function tryInit() {
  if (initAttempted) return;
  initAttempted = true;

  if (process.env.FCM_DISABLED === "true" || process.env.FCM_DISABLED === "1") {
    console.warn("[fcm] FCM_DISABLED — push sends are skipped");
    return;
  }

  if (admin.apps.length > 0) {
    configured = true;
    return;
  }

  try {
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (inline) {
      const parsed = JSON.parse(inline);
      admin.initializeApp({ credential: admin.credential.cert(parsed) });
      configured = true;
      return;
    }
    if (path && existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      admin.initializeApp({ credential: admin.credential.cert(parsed) });
      configured = true;
      return;
    }
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    configured = true;
  } catch (e) {
    console.warn("[fcm] Firebase not initialized — pushes skipped (%s)", e.message);
    configured = false;
  }
}

export function isFcmConfigured() {
  tryInit();
  return configured;
}

/**
 * @param {string[]} tokens
 * @param {Record<string, string>} data - FCM data map (string values)
 * @returns {Promise<{ success: number; failure: number }>}
 */
export async function sendDataToTokens(tokens, data) {
  tryInit();
  if (!configured) {
    console.warn("[fcm] skip send — not configured | tokenCount=%s", tokens.length);
    return { success: 0, failure: tokens.length };
  }

  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) return { success: 0, failure: 0 };

  const messaging = admin.messaging();
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v == null ? "" : String(v)])
  );

  const chunkSize = 500;
  let success = 0;
  let failure = 0;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      data: stringData,
    });
    success += res.successCount;
    failure += res.failureCount;
    res.responses.forEach((r, idx) => {
      if (!r.success) {
        console.warn("[fcm] token failed | %s | %s", chunk[idx], r.error?.message);
      }
    });
  }

  return { success, failure };
}
