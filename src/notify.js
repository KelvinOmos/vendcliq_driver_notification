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

/** Same lifecycle as bubbles.bidcreate (cohort + “new request” notification). */
function isBidCreateEventType(t) {
  return t === "bubbles.bidcreate" || t === "bubbles.bidrequestcreated";
}

function pick(body, key) {
  const top = body?.[key];
  if (top !== undefined && top !== null && top !== "") return top;
  const nested = body?.data?.[key];
  if (nested !== undefined && nested !== null && nested !== "") return nested;
  return undefined;
}

/**
 * bidRequestId from body/data or bubbles-style metadata (originalData, trackingId).
 */
function pickBidRequestId(body) {
  const v =
    pick(body, "bidRequestId") ??
    pick(body, "bid_request_id") ??
    body?.metadata?.originalData?.bidRequestId ??
    body?.metadata?.originalData?.bid_request_id ??
    body?.metadata?.trackingId;
  if (v === undefined || v === null || v === "") return undefined;
  return String(v).trim();
}

/** Partner/driver id arrays from top-level or `data` (notification-service shapes). */
function collectArrayPartnerIds(body) {
  const out = [];
  const add = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) {
      if (x !== undefined && x !== null && x !== "") out.push(String(x).trim());
    }
  };
  add(body?.devices);
  const d = body?.data;
  if (d && typeof d === "object") {
    add(d.devices);
    add(d.partnerIds);
    add(d.driverIds);
    add(d.driverPartnerIds);
    add(d.losingPartners);
  }
  return out;
}

function isRecipientAll(value) {
  if (value === undefined || value === null || value === "") return false;
  return String(value).trim().toLowerCase() === "all";
}

function resolveGenericTargets(body) {
  const targets = collectArrayPartnerIds(body);
  const recipient = pick(body, "recipient");
  const partnerId = pick(body, "partnerId");
  const userId = pick(body, "userId");
  if (recipient && !isRecipientAll(recipient)) {
    targets.push(String(recipient).trim());
  }
  if (
    partnerId !== undefined &&
    partnerId !== null &&
    partnerId !== "" &&
    String(partnerId).trim() !== String(recipient ?? "").trim()
  ) {
    targets.push(String(partnerId).trim());
  }
  if (userId !== undefined && userId !== null && userId !== "") {
    targets.push(String(userId).trim());
  }
  return [...new Set(targets.filter(Boolean))];
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
  const bidId = pick(body, "bidId");
  const bidRequestId = pickBidRequestId(body);
  const status = pick(body, "status");
  const amount = pick(body, "amount");
  const tripId = pick(body, "tripId");
  const itemId = pick(body, "itemId");
  const invoiceId = pick(body, "invoiceId");
  const partnerId = pick(body, "partnerId");
  const outcome = pick(body, "outcome");

  if (bidId) data.bidId = String(bidId);
  if (bidRequestId) data.bidRequestId = String(bidRequestId);
  if (status) data.status = String(status);
  if (amount != null) data.amount = String(amount);
  if (tripId) data.tripId = String(tripId);
  if (itemId) data.itemId = String(itemId);
  if (invoiceId) data.invoiceId = String(invoiceId);
  if (partnerId) data.partnerId = String(partnerId);
  if (outcome) data.outcome = String(outcome);
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
    const amt = pick(body, "amount") != null ? String(pick(body, "amount")) : "";
    return {
      title: "Bid accepted",
      body: custom ?? (amt ? `Your bid was accepted. Amount: ${amt}` : "Your bid was accepted."),
    };
  }

  if (eventType === "bubbles.rejected") {
    const amt = pick(body, "amount") != null ? String(pick(body, "amount")) : "";
    return {
      title: "Bid rejected",
      body: custom ?? (amt ? `Your bid was not selected. Amount: ${amt}` : "Your bid was not selected."),
    };
  }

  if (eventType === "bubbles.updates") {
    const status = pick(body, "status") ? String(pick(body, "status")) : "";
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

  if (isBidCreateEventType(eventType)) {
    const name = body.item?.product?.name ?? body.data?.item?.product?.name;
    return {
      title: "New delivery request",
      body: custom ?? (name ? `New request: ${name}` : "You have a new bid request."),
    };
  }

  if (eventType === "bubbles.tripstarted") {
    const tripId = pick(body, "tripId");
    return {
      title: "Trip started",
      body: custom ?? (tripId ? `Trip ${tripId} has started.` : "Your trip has started."),
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
  const recipient = pick(body, "recipient") || pick(body, "partnerId");
  if (!recipient || isRecipientAll(recipient)) {
    const err = new Error("missing_recipient");
    err.status = 400;
    throw err;
  }
  await sendToTargets([String(recipient).trim()], body);
}

async function handleBidRequestUpdate(body) {
  const bidRequestId = pickBidRequestId(body);
  const recipientRaw = pick(body, "recipient");

  if (isRecipientAll(recipientRaw)) {
    const targets = await resolveTargetsForClosedBidRequest(bidRequestId);
    await sendToTargets(targets, body);
    return;
  }

  if (recipientRaw && !isRecipientAll(recipientRaw)) {
    await sendToTargets([String(recipientRaw).trim()], body);
    return;
  }

  const fromDevices = collectArrayPartnerIds(body);
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
    case "bubbles.bidcreate":
    case "bubbles.bidrequestcreated": {
      const bidRequestId = pickBidRequestId(body);
      const devices = resolveGenericTargets(body);
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
  const unique = resolveGenericTargets(body);
  console.info("[notify] generic event=%s targets=%s", eventType, JSON.stringify(unique));
  await sendToTargets(unique, body);
}
