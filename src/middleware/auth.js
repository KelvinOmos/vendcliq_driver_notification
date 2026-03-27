/**
 * Shared secret for server-to-server calls.
 * Accepts: Authorization: Bearer <secret> OR X-Webhook-Secret: <secret>
 */
export function webhookAuth(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error("WEBHOOK_SECRET is not set");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const bearer = req.get("authorization");
  const headerSecret = req.get("x-webhook-secret");

  let provided = headerSecret;
  if (bearer?.startsWith("Bearer ")) {
    provided = bearer.slice(7).trim();
  }

  if (!provided || provided !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}
