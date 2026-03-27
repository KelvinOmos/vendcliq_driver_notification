import { sendDataToTokens } from "./fcm.js";
import { getFcmTokensForPartnerIds, getPartnerIdsForClosedBidRequest } from "./tokenLookup.js";

/**
 * Resolve recipients and send FCM (or enqueue). Configure TOKEN_LOOKUP_URL + Firebase.
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
      "[notify] CLOSED broadcast — no partnerIds (set CLOSED_BID_PARTNERS_LOOKUP_URL on logistics API) bidRequestId=%s",
      bidRequestId
    );
  }
  return partnerIds;
}

async function sendToTargets(targetIds, body) {
  const data = buildFcmData(body);
  if (targetIds.length === 0) {
    console.warn("[notify] no targets — skipped send | data=%s", JSON.stringify(data));
    return;
  }

  const tokens = await getFcmTokensForPartnerIds(targetIds);
  if (tokens.length === 0) {
    console.warn(
      "[notify] no FCM tokens for partners=%s | data=%s",
      JSON.stringify(targetIds),
      JSON.stringify(data)
    );
    return;
  }

  const { success, failure } = await sendDataToTokens(tokens, data);
  console.info(
    "[notify] fcm | partners=%s tokens=%s ok=%s fail=%s",
    targetIds.length,
    tokens.length,
    success,
    failure
  );
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
