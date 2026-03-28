import { Router } from "express";
import { logEvent } from "../fileLog.js";
import { webhookAuth } from "../middleware/auth.js";
import { deliverDriverNotification, normalizeEventType } from "../notify.js";

const router = Router();

function webhookError(err, res, meta = {}) {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  const code =
    err.message === "missing_recipient"
      ? "missing_recipient"
      : err.message === "missing_event_type"
        ? "missing_event_type"
        : err.message === "event_type_mismatch"
          ? "event_type_mismatch"
          : "delivery_failed";
  if (status >= 500) {
    console.error("[webhook] deliver failed", err);
  }
  logEvent(status >= 500 ? "error" : "warn", "webhook_error", {
    ...meta,
    status,
    code,
    message: err.message,
  });
  if (status === 400) {
    return res.status(400).json({ error: code });
  }
  return res.status(500).json({ error: code });
}

async function postWebhook(req, res, options = {}) {
  const body = req.body;
  const url = req.originalUrl ?? req.url;
  if (!body || typeof body !== "object") {
    logEvent("warn", "webhook_invalid_json", { url });
    return res.status(400).json({ error: "invalid_json" });
  }

  const eventType = normalizeEventType(body);
  if (!eventType) {
    logEvent("warn", "webhook_missing_event_type", { url });
    return res.status(400).json({ error: "missing_event_type" });
  }

  try {
    await deliverDriverNotification(body, options);
    logEvent("info", "webhook_ok", { url, eventType });
    return res.status(204).send();
  } catch (err) {
    return webhookError(err, res, { url, eventType });
  }
}

/** Any supported event (legacy / catch-all). */
router.post("/driver-notifications", webhookAuth, (req, res) => postWebhook(req, res));

/** Bid accepted — expects eventType `bubbles.bidaccepted`. */
router.post("/bubbles/bid-accepted", webhookAuth, (req, res) =>
  postWebhook(req, res, { restrictEventType: "bubbles.bidaccepted" })
);

/** Bid-request lifecycle (e.g. CLOSED) — expects eventType `bubbles.updates`. */
router.post("/bubbles/bid-request-updates", webhookAuth, (req, res) =>
  postWebhook(req, res, { restrictEventType: "bubbles.updates" })
);

export { router as webhookRouter };
