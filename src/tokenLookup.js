/**
 * Call your logistics API: partner UUIDs → FCM registration tokens.
 * POST body: { partnerIds: string[] }
 * Response JSON: { tokensByPartnerId: { "<uuid>": "<fcmToken>", ... } }
 * Optional: { tokens: ["fcm1","fcm2"] } aligned with partnerIds order (if same length).
 */

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

/**
 * @param {string[]} partnerIds
 * @returns {Promise<string[]>} FCM tokens (order preserved, duplicates dropped for send)
 */
export async function getFcmTokensForPartnerIds(partnerIds) {
  const ids = [...new Set(partnerIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const url = process.env.TOKEN_LOOKUP_URL;
  if (!url) {
    console.warn("[tokens] TOKEN_LOOKUP_URL not set — cannot resolve FCM tokens");
    return [];
  }

  const json = await postJson(url, { partnerIds: ids });

  if (json.tokensByPartnerId && typeof json.tokensByPartnerId === "object") {
    const map = json.tokensByPartnerId;
    return ids.map((id) => map[id]).filter(Boolean);
  }

  if (Array.isArray(json.tokens) && json.tokens.length === ids.length) {
    return json.tokens.filter(Boolean);
  }

  console.warn("[tokens] unexpected response shape from TOKEN_LOOKUP_URL");
  return [];
}

/**
 * Who should get "bid request closed" for this id (partner UUIDs).
 * POST body: { bidRequestId: string }
 * Response JSON: { partnerIds: string[] }
 */
export async function getPartnerIdsForClosedBidRequest(bidRequestId) {
  if (!bidRequestId) return [];

  const url = process.env.CLOSED_BID_PARTNERS_LOOKUP_URL;
  if (!url) {
    return [];
  }

  const json = await postJson(url, { bidRequestId });
  const ids = json.partnerIds;
  return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
}
