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
 * Sends display notification (tray) + data payload for the Flutter app to handle taps / routing.
 *
 * @param {string[]} tokens
 * @param {Record<string, string>} data - FCM data map (string values)
 * @param {{ title: string; body: string }} notification - visible title/body in notification shade
 * @returns {Promise<{ success: number; failure: number }>}
 */
export async function sendDriverPush(tokens, data, notification) {
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

  const androidChannelId = process.env.FCM_ANDROID_CHANNEL_ID?.trim();

  const chunkSize = 500;
  let success = 0;
  let failure = 0;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const androidNotification = {
      sound: "default",
    };
    if (androidChannelId) {
      androidNotification.channelId = androidChannelId;
    }

    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      data: stringData,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      android: {
        priority: "high",
        notification: androidNotification,
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
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

/**
 * Send one message to an FCM topic (all app instances subscribed to that topic).
 * Flutter: `FirebaseMessaging.instance.subscribeToTopic('<same-name>')`.
 *
 * @param {string} topic - e.g. `all_drivers` (FCM: letters, numbers, -_.~% only)
 * @param {Record<string, string>} data
 * @param {{ title: string; body: string }} notification
 * @returns {Promise<{ success: number; failure: number }>}
 */
export async function sendDriverPushToTopic(topic, data, notification) {
  tryInit();
  if (!configured) {
    console.warn("[fcm] skip topic send — not configured | topic=%s", topic);
    return { success: 0, failure: 1 };
  }

  const t = String(topic ?? "").trim();
  if (!t) {
    console.warn("[fcm] skip topic send — empty topic");
    return { success: 0, failure: 0 };
  }

  const messaging = admin.messaging();
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v == null ? "" : String(v)])
  );

  const androidChannelId = process.env.FCM_ANDROID_CHANNEL_ID?.trim();
  const androidNotification = { sound: "default" };
  if (androidChannelId) {
    androidNotification.channelId = androidChannelId;
  }

  try {
    await messaging.send({
      topic: t,
      data: stringData,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      android: {
        priority: "high",
        notification: androidNotification,
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });
    return { success: 1, failure: 0 };
  } catch (e) {
    console.error("[fcm] topic send failed | topic=%s | %s", t, e?.message ?? e);
    return { success: 0, failure: 1 };
  }
}
