/**
 * Logistics data for this API: partner ↔ FCM token, bid-request ↔ eligible partners.
 *
 * - `LOGISTICS_STORE_MODE=memory` — in-process maps for local/dev (lost on restart).
 * - Default `stub` — returns empty / 501 until you add your database (Postgres, etc.).
 *
 * Replace the stub branch with your ORM/queries when you go to production.
 */

const MODE = process.env.LOGISTICS_STORE_MODE || "stub";

/** @type {Map<string, string>} partnerId -> FCM registration token */
const memPartnerToken = new Map();

/** @type {Map<string, string[]>} bidRequestId -> partnerIds notified for bidcreate */
const memBidPartners = new Map();

/**
 * @param {string} partnerId
 * @param {string} fcmToken
 */
export async function saveDriverFcmToken(partnerId, fcmToken) {
  if (MODE === "memory") {
    memPartnerToken.set(partnerId, fcmToken);
    return;
  }
  const err = new Error("logistics_store_not_configured");
  err.status = 501;
  throw err;
}

/**
 * @param {string[]} partnerIds
 * @returns {Promise<string[]>}
 */
export async function getFcmTokensForPartnerIds(partnerIds) {
  const ids = [...new Set(partnerIds.filter(Boolean))];
  if (ids.length === 0) return [];

  if (MODE === "memory") {
    return ids.map((id) => memPartnerToken.get(id)).filter(Boolean);
  }

  console.warn("[store] getFcmTokensForPartnerIds — implement DB (or LOGISTICS_STORE_MODE=memory)");
  return [];
}

/**
 * Call when a bid request is opened so CLOSED can fan out to the same cohort.
 * @param {string} bidRequestId
 * @param {string[]} partnerIds
 */
export async function recordPartnersEligibleForBidRequest(bidRequestId, partnerIds) {
  const id = bidRequestId?.trim();
  if (!id || !Array.isArray(partnerIds)) return;

  const unique = [...new Set(partnerIds.filter(Boolean))];
  if (MODE === "memory") {
    memBidPartners.set(id, unique);
    return;
  }

  console.warn(
    "[store] recordPartnersEligibleForBidRequest — implement DB for bidRequestId=%s",
    id
  );
}

/**
 * @param {string} bidRequestId
 * @returns {Promise<string[]>}
 */
export async function getPartnerIdsForClosedBidRequest(bidRequestId) {
  const id = bidRequestId?.trim();
  if (!id) return [];

  if (MODE === "memory") {
    return memBidPartners.get(id) ?? [];
  }

  console.warn(
    "[store] getPartnerIdsForClosedBidRequest — implement DB for bidRequestId=%s",
    id
  );
  return [];
}
