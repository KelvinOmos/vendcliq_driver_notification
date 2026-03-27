import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { webhookRouter } from "./routes/webhook.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "512kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/webhooks", webhookRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(port, () => {
  const base = `http://localhost:${port}`;
  console.info("Webhook listening on %s", base);
  console.info("POST %s/webhooks/driver-notifications (any event)", base);
  console.info("POST %s/webhooks/bubbles/bid-accepted", base);
  console.info("POST %s/webhooks/bubbles/bid-request-updates", base);
});
