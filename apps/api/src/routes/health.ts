import type { FastifyInstance } from "fastify";
import { checkDatabaseConnection, checkPgVectorExtension } from "@repomind/database";
import { checkRedisConnection } from "@repomind/worker";
import type { HealthStatus } from "@repomind/shared";

export async function registerHealthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async (request, reply) => {
    const [postgresOk, pgvectorOk, redisOk] = await Promise.all([
      checkDatabaseConnection(),
      checkPgVectorExtension(),
      checkRedisConnection(),
    ]);

    const isHealthy = postgresOk && pgvectorOk && redisOk;

    const response: HealthStatus = {
      status: isHealthy ? "ok" : "error",
      timestamp: new Date().toISOString(),
      services: {
        postgres: {
          status: postgresOk ? "connected" : "disconnected",
          pgvector: pgvectorOk,
        },
        redis: {
          status: redisOk ? "connected" : "disconnected",
        },
      },
    };

    const statusCode = isHealthy ? 200 : 503;
    return reply.status(statusCode).send(response);
  });
}
