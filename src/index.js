import "dotenv/config";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createAccessLogStream, isFileLoggingEnabled, logEvent } from "./fileLog.js";
import { logisticsApiRouter } from "./routes/logisticsApi.js";
import { webhookRouter } from "./routes/webhook.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "512kb" }));

const accessStream = createAccessLogStream();
if (accessStream) {
  app.use(morgan("combined", { stream: accessStream }));
}

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.status(200).json({
    service: "vendcliq-driver-notification",
    status: "ok",
    endpoints: {
      health: "GET /health",
      webhooks: {
        anyEvent: "POST /webhooks/driver-notifications",
        bidAccepted: "POST /webhooks/bubbles/bid-accepted",
        bidRequestUpdates: "POST /webhooks/bubbles/bid-request-updates",
      },
      devices: "POST /api/v1/drivers/fcm-token",
    },
  });
});

app.use("/webhooks", webhookRouter);
app.use("/api/v1", logisticsApiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

// Bind all interfaces so Render/proxy can reach the process (localhost-only causes 502).
app.listen(port, "0.0.0.0", () => {
  console.info(
    "[boot] env present: LOGISTICS_API_KEY=%s WEBHOOK_SECRET=%s",
    Boolean(process.env.LOGISTICS_API_KEY),
    Boolean(process.env.WEBHOOK_SECRET)
  );
  if (isFileLoggingEnabled()) {
    logEvent("info", "server_start", { port, fileLogging: true });
  }
  const base = `http://localhost:${port}`;
  console.info("Webhook listening on %s", base);
  console.info("POST %s/webhooks/driver-notifications (any event)", base);
  console.info("POST %s/webhooks/bubbles/bid-accepted", base);
  console.info("POST %s/webhooks/bubbles/bid-request-updates", base);
  console.info("POST %s/api/v1/drivers/fcm-token (LOGISTICS_API_KEY)", base);
});
