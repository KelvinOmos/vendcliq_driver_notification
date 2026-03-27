import * as store from "./logisticsStore.js";

async function postJson(url, body) {
  const secret = process.env.INTERNAL_API_SECRET ?? process.env.TOKEN_LOOKUP_SECRET ?? "";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`lookup_http_${res.status}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

async function httpGetFcmTokens(url, partnerIds) {
  const json = await postJson(url, { partnerIds });

  if (json.tokensByPartnerId && typeof json.tokensByPartnerId === "object") {
    const map = json.tokensByPartnerId;
    return partnerIds.map((id) => map[id]).filter(Boolean);
  }

  if (Array.isArray(json.tokens) && json.tokens.length === partnerIds.length) {
    return json.tokens.filter(Boolean);
  }

  console.warn("[tokens] unexpected response shape from TOKEN_LOOKUP_URL");
  return [];
}

/**
 * Partner UUIDs → FCM tokens.
 * If `TOKEN_LOOKUP_URL` is set (split deployment), call remote API; else this logistics API’s store.
 *
 * @param {string[]} partnerIds
 * @returns {Promise<string[]>}
 */
export async function getFcmTokensForPartnerIds(partnerIds) {
  const ids = [...new Set(partnerIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const url = process.env.TOKEN_LOOKUP_URL;
  if (url) {
    return httpGetFcmTokens(url, ids);
  }

  return store.getFcmTokensForPartnerIds(ids);
}

/**
 * bidRequestId → partner UUIDs for CLOSED broadcast.
 * If `CLOSED_BID_PARTNERS_LOOKUP_URL` is set, HTTP; else in-process store.
 */
export async function getPartnerIdsForClosedBidRequest(bidRequestId) {
  if (!bidRequestId) return [];

  const url = process.env.CLOSED_BID_PARTNERS_LOOKUP_URL;
  if (url) {
    const json = await postJson(url, { bidRequestId });
    const raw = json.partnerIds;
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  }

  return store.getPartnerIdsForClosedBidRequest(bidRequestId);
}
