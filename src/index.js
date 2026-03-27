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
  console.info("Webhook listening on http://localhost:%s", port);
  console.info("POST http://localhost:%s/webhooks/driver-notifications", port);
});
