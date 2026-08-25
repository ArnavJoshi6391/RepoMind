import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { config } from "./config.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  const allowedOrigins = config.CORS_ORIGIN.includes(",")
    ? config.CORS_ORIGIN.split(",").map((o) => o.trim())
    : config.CORS_ORIGIN;

  await app.register(cors, {
    origin: allowedOrigins,
  });

  await registerHealthRoutes(app);
  await registerWebhookRoutes(app);

  return app;
}
