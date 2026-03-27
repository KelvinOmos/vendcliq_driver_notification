import { Router } from "express";
import { webhookAuth } from "../middleware/auth.js";
import { deliverDriverNotification } from "../notify.js";

const router = Router();

router.post("/driver-notifications", webhookAuth, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "invalid_json" });
  }

  const eventType = body.eventType ?? body.metadata?.bubblesEventType;
  if (!eventType || typeof eventType !== "string") {
    return res.status(400).json({ error: "missing_event_type" });
  }

  try {
    await deliverDriverNotification(body);
    return res.status(204).send();
  } catch (err) {
    console.error("[webhook] deliver failed", err);
    return res.status(500).json({ error: "delivery_failed" });
  }
});

export { router as webhookRouter };
