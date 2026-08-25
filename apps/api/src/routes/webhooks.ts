import type { FastifyInstance } from "fastify";
import { verifyWebhookSignature, parseWebhookHeaders } from "@repomind/github";
import { createDbClient, githubWebhookDeliveries, repositories, githubInstallations } from "@repomind/database";
import { eq } from "drizzle-orm";
import { config } from "../config.js";

export async function registerWebhookRoutes(fastify: FastifyInstance) {
  // Ensure raw body Buffer parser is registered for GitHub webhook payload verification
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      done(null, body);
    }
  );

  fastify.post("/api/webhooks/github", async (request, reply) => {
    const rawBody = request.body as Buffer;

    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      return reply.status(400).send({ error: "Invalid request payload. Expected raw Buffer." });
    }

    const headers = parseWebhookHeaders(request.headers as Record<string, string | string[]>);
    if (!headers) {
      return reply.status(400).send({ error: "Missing required GitHub webhook headers (X-GitHub-Delivery, X-GitHub-Event, X-Hub-Signature-256)." });
    }

    // Step 1: Verification order: raw Buffer → HMAC-SHA256 → constant-time comparison
    const isValidSignature = verifyWebhookSignature(
      rawBody,
      headers.signature,
      config.GITHUB_WEBHOOK_SECRET
    );

    if (!isValidSignature) {
      return reply.status(401).send({ error: "Invalid webhook signature." });
    }

    // Step 2: Parse JSON only AFTER signature verification succeeds
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString("utf-8"));
    } catch (err) {
      return reply.status(400).send({ error: "Invalid JSON payload." });
    }

    const { db, sql } = createDbClient();

    try {
      // Step 3: Atomic Idempotency Claim using database UNIQUE constraint on delivery_id
      let deliveryRecordId: string | null = null;
      try {
        const [inserted] = await db
          .insert(githubWebhookDeliveries)
          .values({
            deliveryId: headers.deliveryId,
            eventType: headers.eventType,
            status: "received",
          })
          .returning({ id: githubWebhookDeliveries.id });

        deliveryRecordId = inserted.id;
      } catch (dbErr: any) {
        // Handle unique constraint conflict on delivery_id (duplicate delivery attempt)
        const existing = await db
          .select()
          .from(githubWebhookDeliveries)
          .where(eq(githubWebhookDeliveries.deliveryId, headers.deliveryId))
          .limit(1);

        if (existing.length > 0 && existing[0].status === "processed") {
          return reply.status(200).send({ status: "ignored", reason: "duplicate_delivery" });
        }

        // If duplicate in flight or failed state, handle safely
        return reply.status(200).send({ status: "ignored", reason: "delivery_already_received" });
      }

      // Step 4: Event processing for supported events (push, installation, installation_repositories)
      if (headers.eventType === "push" && payload.repository) {
        const githubRepoId = BigInt(payload.repository.id);
        const commitSha = payload.after || payload.head_commit?.id || null;

        await db
          .update(repositories)
          .set({
            lastIndexedCommit: commitSha,
            syncMetadata: {
              lastPushAt: new Date().toISOString(),
              ref: payload.ref,
              pusher: payload.pusher?.name || null,
            },
            updatedAt: new Date(),
          })
          .where(eq(repositories.githubRepoId, githubRepoId));
      } else if (headers.eventType === "installation" && payload.installation) {
        const installationId = BigInt(payload.installation.id);
        const accountId = BigInt(payload.installation.account.id);

        if (payload.action === "created") {
          await db
            .insert(githubInstallations)
            .values({
              githubInstallationId: installationId,
              accountId: accountId,
              accountLogin: payload.installation.account.login,
              accountType: payload.installation.account.type,
            })
            .onConflictDoUpdate({
              target: githubInstallations.githubInstallationId,
              set: {
                accountLogin: payload.installation.account.login,
                updatedAt: new Date(),
              },
            });
        }
      }

      // Step 5: Mark delivery status as processed
      if (deliveryRecordId) {
        await db
          .update(githubWebhookDeliveries)
          .set({
            status: "processed",
            processedAt: new Date(),
          })
          .where(eq(githubWebhookDeliveries.id, deliveryRecordId));
      }

      return reply.status(200).send({ status: "success", deliveryId: headers.deliveryId });
    } finally {
      await sql.end();
    }
  });
}
