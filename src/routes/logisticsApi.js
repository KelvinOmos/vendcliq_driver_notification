import { Router } from "express";
import { logisticsApiKeyAuth } from "../middleware/logisticsApiKey.js";
import { saveDriverFcmToken } from "../logisticsStore.js";

const router = Router();

/** Flutter / driver app registers or refreshes FCM token for a partner. */
router.post("/drivers/fcm-token", logisticsApiKeyAuth, async (req, res) => {
  const { partnerId, fcmToken } = req.body ?? {};
  if (!partnerId || typeof partnerId !== "string" || !fcmToken || typeof fcmToken !== "string") {
    return res.status(400).json({ error: "partnerId_and_fcmToken_required" });
  }

  try {
    await saveDriverFcmToken(partnerId.trim(), fcmToken.trim());
    return res.status(204).send();
  } catch (err) {
    const status = err.status === 501 ? 501 : 500;
    if (status === 501) {
      return res.status(501).json({
        error: "logistics_store_not_configured",
        hint: "Set LOGISTICS_STORE_MODE=memory for dev or implement logisticsStore.js with your DB",
      });
    }
    console.error("[api] saveDriverFcmToken", err);
    return res.status(500).json({ error: "save_failed" });
  }
});

export { router as logisticsApiRouter };
