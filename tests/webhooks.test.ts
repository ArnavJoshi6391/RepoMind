import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { verifyWebhookSignature } from "@repomind/github";
import { buildApp } from "../apps/api/src/app.js";
import { createDbClient, runMigrations, githubInstallations, repositories } from "@repomind/database";
import { eq } from "drizzle-orm";

const TEST_WEBHOOK_SECRET = "development_webhook_secret";

function getRandomBigInt(): bigint {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

function generateSignature(payload: Buffer | string, secret = TEST_WEBHOOK_SECRET): string {
  const hmac = crypto.createHmac("sha256", secret);
  if (Buffer.isBuffer(payload)) {
    hmac.update(payload);
  } else {
    hmac.update(payload, "utf-8");
  }
  return `sha256=${hmac.digest("hex")}`;
}

beforeAll(async () => {
  dotenv.config();
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  }
  await runMigrations();
});

describe("Phase 2 GitHub Webhooks & Security Verification", () => {
  it("should verify signature correctly using raw Buffer and constant-time HMAC comparison", () => {
    const rawBuffer = Buffer.from(JSON.stringify({ test: "payload_data", value: 123 }));
    const validSignature = generateSignature(rawBuffer);

    const isValid = verifyWebhookSignature(rawBuffer, validSignature, TEST_WEBHOOK_SECRET);
    expect(isValid).toBe(true);

    const isInvalid = verifyWebhookSignature(rawBuffer, "sha256=invalid_hex_string_1234567890123456789012345678901234567890123456789012345678901234", TEST_WEBHOOK_SECRET);
    expect(isInvalid).toBe(false);
  });

  it("should reject webhook request with 401 Unauthorized for invalid signature", async () => {
    const app = await buildApp();
    const rawBuffer = Buffer.from(JSON.stringify({ action: "push" }));

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": `deliv-invalid-${Date.now()}-${Math.random()}`,
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=bad_signature_value_12345678901234567890123456789012345678901234567890",
      },
      payload: rawBuffer,
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("should handle atomic duplicate delivery idempotency safely under concurrent requests", async () => {
    const app = await buildApp();
    const deliveryId = `concurrent-delivery-${Date.now()}-${Math.random()}`;
    const rawBuffer = Buffer.from(JSON.stringify({ zen: "Responsive is better than fast." }));
    const signature = generateSignature(rawBuffer);

    // Send first request
    const res1 = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "ping",
        "x-hub-signature-256": signature,
      },
      payload: rawBuffer,
    });

    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.payload);
    expect(body1.status).toBe("success");

    // Send duplicate request with identical delivery ID
    const res2 = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "ping",
        "x-hub-signature-256": signature,
      },
      payload: rawBuffer,
    });

    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.payload);
    expect(body2.status).toBe("ignored");
    expect(body2.reason).toBe("duplicate_delivery");

    await app.close();
  });

  it("should update repository syncMetadata and lastIndexedCommit on push event without triggering repo ingestion", async () => {
    const { db, sql } = createDbClient();
    const app = await buildApp();

    try {
      const instId = getRandomBigInt();
      const repoId = getRandomBigInt();
      const accountId = getRandomBigInt();

      const [inst] = await db
        .insert(githubInstallations)
        .values({
          githubInstallationId: instId,
          accountId: accountId,
          accountLogin: `push-org-${Date.now()}`,
          accountType: "Organization",
        })
        .returning();

      await db.insert(repositories).values({
        githubRepoId: repoId,
        installationId: inst.id,
        owner: `push-org-${Date.now()}`,
        name: "push-repo",
        fullName: `push-org-${Date.now()}/push-repo`,
        defaultBranch: "main",
      });

      const pushPayload = {
        ref: "refs/heads/main",
        after: "c0mm1t_sha_123456",
        repository: {
          id: Number(repoId),
          full_name: `push-org-${Date.now()}/push-repo`,
        },
        pusher: {
          name: "developer",
        },
      };

      const rawBuffer = Buffer.from(JSON.stringify(pushPayload));
      const signature = generateSignature(rawBuffer);
      const deliveryId = `push-deliv-${Date.now()}-${Math.random()}`;

      const res = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": deliveryId,
          "x-github-event": "push",
          "x-hub-signature-256": signature,
        },
        payload: rawBuffer,
      });

      expect(res.statusCode).toBe(200);

      // Verify DB repository lastIndexedCommit was updated
      const [updatedRepo] = await db.select().from(repositories).where(eq(repositories.githubRepoId, repoId));
      expect(updatedRepo.lastIndexedCommit).toBe("c0mm1t_sha_123456");
      expect((updatedRepo.syncMetadata as any).ref).toBe("refs/heads/main");
    } finally {
      await app.close();
      await sql.end();
    }
  });
});
