import { describe, it, expect, beforeAll } from "vitest";
import dotenv from "dotenv";

beforeAll(() => {
  dotenv.config();
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  }
});

import { checkDatabaseConnection, checkPgVectorExtension } from "@repomind/database";
import { checkRedisConnection, verifyBullMQ } from "@repomind/worker";
import { buildApp } from "../apps/api/src/app.js";

describe("Phase 1 Infrastructure & Foundation Verification", () => {
  it("should successfully connect to PostgreSQL 16", async () => {
    const isDbConnected = await checkDatabaseConnection();
    expect(isDbConnected).toBe(true);
  });

  it("should verify pgvector extension availability via SELECT extname FROM pg_extension WHERE extname = 'vector'", async () => {
    const hasPgVector = await checkPgVectorExtension();
    expect(hasPgVector).toBe(true);
  });

  it("should successfully connect to Redis 7", async () => {
    const isRedisConnected = await checkRedisConnection();
    expect(isRedisConnected).toBe(true);
  });

  it("should explicitly execute and process a BullMQ dummy job through worker queue", async () => {
    const bullMqResult = await verifyBullMQ();
    expect(bullMqResult.success).toBe(true);
    expect(bullMqResult.result).toContain("PROCESSED:test-");
  });

  it("should respond with 200 OK and detailed status from GET /health endpoint", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe("ok");
    expect(body.services.postgres.status).toBe("connected");
    expect(body.services.postgres.pgvector).toBe(true);
    expect(body.services.redis.status).toBe("connected");
    await app.close();
  });
});
