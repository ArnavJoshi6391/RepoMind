import { z } from "zod";

export const HealthStatusSchema = z.object({
  status: z.enum(["ok", "error"]),
  timestamp: z.string(),
  services: z.object({
    postgres: z.object({
      status: z.enum(["connected", "disconnected"]),
      pgvector: z.boolean(),
    }),
    redis: z.object({
      status: z.enum(["connected", "disconnected"]),
    }),
  }),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const DummyJobPayloadSchema = z.object({
  jobId: z.string(),
  message: z.string(),
  timestamp: z.number(),
});

export type DummyJobPayload = z.infer<typeof DummyJobPayloadSchema>;

export const RepositoryStatusSchema = z.enum(["active", "paused", "archived", "deleted"]);
export type RepositoryStatus = z.infer<typeof RepositoryStatusSchema>;

export const IndexingJobStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);
export type IndexingJobStatus = z.infer<typeof IndexingJobStatusSchema>;

export const WebhookDeliveryStatusSchema = z.enum(["received", "processed", "failed"]);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;
