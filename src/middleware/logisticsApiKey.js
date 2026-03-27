/**
 * Secures mobile/logistics routes (e.g. FCM token upsert). Replace with JWT when you have driver auth.
 */
export function logisticsApiKeyAuth(req, res, next) {
  const expected = process.env.LOGISTICS_API_KEY;
  if (!expected) {
    console.error("LOGISTICS_API_KEY is not set");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const header = req.get("x-api-key");
  const bearer = req.get("authorization");
  const fromBearer = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : null;
  const provided = header || fromBearer;

  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}
