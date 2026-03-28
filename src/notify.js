import { logEvent } from "./fileLog.js";
import { sendDriverPush } from "./fcm.js";
import { recordPartnersEligibleForBidRequest } from "./logisticsStore.js";
import { getFcmTokensForPartnerIds, getPartnerIdsForClosedBidRequest } from "./tokenLookup.js";

/**
 * Resolve recipients and send FCM. This process is the logistics API: store + webhooks + optional HTTP lookups.
 *
 * @param {object} body - Parsed JSON body from POST webhooks
 * @returns {Promise<void>}
 */
export function normalizeEventType(body) {
  const t = body?.eventType ?? body?.metadata?.bubblesEventType;
  return typeof t === "string" ? t : null;
}

/**
 * Data payload for FCM `data` map (string values only for FCM).
 * Extend as your Flutter app expects.
 */
export function buildFcmData(body) {
  const eventType = normalizeEventType(body);
  const data = {
    eventType: eventType ?? "",
  };
  if (body.bidId) data.bidId = String(body.bidId);
  if (body.bidRequestId) data.bidRequestId = String(body.bidRequestId);
  if (body.status) data.status = String(body.status);
  if (body.amount != null) data.amount = String(body.amount);
  if (body.content) data.content = String(body.content);
  return data;
}

/**
 * Title/body shown in the device notification tray (FCM `notification` payload).
 * `data` still carries ids for Flutter routing when the user taps.
 */
export function buildFcmNotification(body) {
  const eventType = normalizeEventType(body);
  const custom = typeof body.content === "string" && body.content.trim() ? body.content.trim() : null;

  if (eventType === "bubbles.bidaccepted") {
    const amt = body.amount != null ? String(body.amount) : "";
    return {
      title: "Bid accepted",
      body: custom ?? (amt ? `Your bid was accepted. Amount: ${amt}` : "Your bid was accepted."),
    };
  }

  if (eventType === "bubbles.updates") {
    const status = body.status ? String(body.status) : "";
    if (status.toUpperCase() === "CLOSED") {
      return {
        title: "Bid request closed",
        body: custom ?? "This request is no longer open for bids.",
      };
    }
    return {
      title: "Bid update",
      body: custom ?? (status ? `Status: ${status}` : "There is an update to a bid request."),
    };
  }

  if (eventType === "bubbles.bidcreate") {
    const name = body.item?.product?.name;
    return {
      title: "New delivery request",
      body: custom ?? (name ? `New request: ${name}` : "You have a new bid request."),
    };
  }

  return {
    title: "Driver update",
    body: custom ?? (eventType ? eventType.replace(/^.*\./, "").replace(/_/g, " ") : "You have a new notification."),
  };
}

/**
 * Drivers who should be notified that a bid request is closed (everyone who saw the request).
 * Implement: query by bidRequestId → partner/device ids or FCM tokens.
 *
 * @param {string} bidRequestId
 * @returns {Promise<string[]>}
 */
export async function resolveTargetsForClosedBidRequest(bidRequestId) {
  if (!bidRequestId) return [];
  const partnerIds = await getPartnerIdsForClosedBidRequest(bidRequestId);
  if (partnerIds.length === 0) {
    console.warn(
      "[notify] CLOSED broadcast — no partnerIds for bidRequestId=%s (ensure bidcreate was processed, LOGISTICS_STORE_MODE=memory, or implement DB + CLOSED_BID_PARTNERS_LOOKUP_URL)",
      bidRequestId
    );
  }
  return partnerIds;
}

async function sendToTargets(targetIds, body) {
  const data = buildFcmData(body);
  if (targetIds.length === 0) {
    console.warn("[notify] no targets — skipped send | data=%s", JSON.stringify(data));
    logEvent("warn", "fcm_skipped_no_targets", { eventType: data.eventType, data });
    return;
  }

  const tokens = await getFcmTokensForPartnerIds(targetIds);
  if (tokens.length === 0) {
    console.warn(
      "[notify] no FCM tokens for partners=%s | data=%s",
      JSON.stringify(targetIds),
      JSON.stringify(data)
    );
    logEvent("warn", "fcm_skipped_no_tokens", {
      eventType: data.eventType,
      partnerCount: targetIds.length,
      partnerIds: targetIds,
    });
    return;
  }

  const notification = buildFcmNotification(body);
  const { success, failure } = await sendDriverPush(tokens, data, notification);
  console.info(
    "[notify] fcm | partners=%s tokens=%s ok=%s fail=%s",
    targetIds.length,
    tokens.length,
    success,
    failure
  );
  logEvent("info", "fcm_send", {
    eventType: data.eventType,
    partnerCount: targetIds.length,
    tokenCount: tokens.length,
    success,
    failure,
  });
}

async function handleBidAccepted(body) {
  const recipient = body.recipient || body.partnerId;
  if (!recipient || recipient === "all") {
    const err = new Error("missing_recipient");
    err.status = 400;
    throw err;
  }
  await sendToTargets([recipient], body);
}

async function handleBidRequestUpdate(body) {
  const bidRequestId =
    body.bidRequestId ?? body.metadata?.originalData?.bidRequestId ?? body.metadata?.trackingId;

  if (body.recipient === "all") {
    const targets = await resolveTargetsForClosedBidRequest(bidRequestId);
    await sendToTargets(targets, body);
    return;
  }

  if (body.recipient && body.recipient !== "all") {
    await sendToTargets([body.recipient], body);
    return;
  }

  const fromDevices = Array.isArray(body.devices) ? body.devices.filter(Boolean) : [];
  if (fromDevices.length > 0) {
    await sendToTargets([...new Set(fromDevices)], body);
    return;
  }

  console.warn("[notify] bubbles.updates — no recipient/devices for bidRequestId=%s", bidRequestId);
}

/**
 * @param {object} body
 * @param {{ restrictEventType?: string }} [opts]
 */
export async function deliverDriverNotification(body, opts = {}) {
  const eventType = normalizeEventType(body);
  if (!eventType) {
    const err = new Error("missing_event_type");
    err.status = 400;
    throw err;
  }
  if (opts.restrictEventType && eventType !== opts.restrictEventType) {
    const err = new Error("event_type_mismatch");
    err.status = 400;
    throw err;
  }

  switch (eventType) {
    case "bubbles.bidcreate": {
      const bidRequestId =
        body.bidRequestId ?? body.metadata?.originalData?.bidRequestId ?? body.metadata?.trackingId;
      const devices = Array.isArray(body.devices) ? body.devices : [];
      await recordPartnersEligibleForBidRequest(bidRequestId, devices);
      await handleGeneric(body);
      break;
    }
    case "bubbles.bidaccepted":
      await handleBidAccepted(body);
      break;
    case "bubbles.updates":
      await handleBidRequestUpdate(body);
      break;
    default:
      await handleGeneric(body);
      break;
  }
}

async function handleGeneric(body) {
  const eventType = normalizeEventType(body);
  const targets = [];
  if (body.recipient && body.recipient !== "all") targets.push(body.recipient);
  if (Array.isArray(body.devices)) targets.push(...body.devices);
  if (body.partnerId && body.partnerId !== body.recipient) targets.push(body.partnerId);
  const unique = [...new Set(targets.filter(Boolean))];
  console.info("[notify] generic event=%s targets=%s", eventType, JSON.stringify(unique));
  await sendToTargets(unique, body);
}
