import { Router } from "express";
import { webhookAuth } from "../middleware/auth.js";
import { deliverDriverNotification, normalizeEventType } from "../notify.js";

const router = Router();

function webhookError(err, res) {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) {
    console.error("[webhook] deliver failed", err);
  }
  const code =
    err.message === "missing_recipient"
      ? "missing_recipient"
      : err.message === "missing_event_type"
        ? "missing_event_type"
        : err.message === "event_type_mismatch"
          ? "event_type_mismatch"
          : "delivery_failed";
  if (status === 400) {
    return res.status(400).json({ error: code });
  }
  return res.status(500).json({ error: code });
}

async function postWebhook(req, res, options = {}) {
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "invalid_json" });
  }

  const eventType = normalizeEventType(body);
  if (!eventType) {
    return res.status(400).json({ error: "missing_event_type" });
  }

  try {
    await deliverDriverNotification(body, options);
    return res.status(204).send();
  } catch (err) {
    return webhookError(err, res);
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
