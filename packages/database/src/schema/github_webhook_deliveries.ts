import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", ["received", "processed", "failed"]);

export const githubWebhookDeliveries = pgTable(
  "github_webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: text("delivery_id").notNull().unique(), // Atomic UNIQUE constraint for idempotency
    eventType: text("event_type").notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    status: webhookDeliveryStatusEnum("status").default("received").notNull(),
  },
  (table) => [
    index("idx_github_webhook_deliveries_delivery_id").on(table.deliveryId),
  ]
);

export type GithubWebhookDelivery = typeof githubWebhookDeliveries.$inferSelect;
export type NewGithubWebhookDelivery = typeof githubWebhookDeliveries.$inferInsert;
