import { Queue, Worker, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import type { DummyJobPayload } from "@repomind/shared";

export const FOUNDATION_QUEUE_NAME = "foundation-verification-queue";

export function getRedisOptions() {
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    maxRetriesPerRequest: null,
  };
}

export async function checkRedisConnection(host?: string, port?: number): Promise<boolean> {
  const redisHost = host || process.env.REDIS_HOST || "localhost";
  const redisPort = port || parseInt(process.env.REDIS_PORT || "6379", 10);
  const client = new Redis({
    host: redisHost,
    port: redisPort,
    connectTimeout: 5000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await client.connect();
    const ping = await client.ping();
    return ping === "PONG";
  } catch (error) {
    return false;
  } finally {
    client.disconnect();
  }
}

export function createFoundationQueue(connection = getRedisOptions()) {
  return new Queue<DummyJobPayload>(FOUNDATION_QUEUE_NAME, { connection });
}

export function createFoundationWorker(
  connection = getRedisOptions(),
  onProcess?: (jobData: DummyJobPayload) => Promise<string>
) {
  return new Worker<DummyJobPayload>(
    FOUNDATION_QUEUE_NAME,
    async (job) => {
      if (onProcess) {
        return await onProcess(job.data);
      }
      return `Processed job ${job.data.jobId}: ${job.data.message}`;
    },
    { connection }
  );
}

export async function verifyBullMQ(connection = getRedisOptions()): Promise<{ success: boolean; result: string }> {
  const queue = createFoundationQueue(connection);
  const queueEvents = new QueueEvents(FOUNDATION_QUEUE_NAME, { connection });
  await queueEvents.waitUntilReady();

  let processedMessage = "";

  const worker = createFoundationWorker(connection, async (jobData) => {
    processedMessage = `PROCESSED:${jobData.jobId}:${jobData.message}`;
    return processedMessage;
  });

  await worker.waitUntilReady();

  const testPayload: DummyJobPayload = {
    jobId: `test-${Date.now()}`,
    message: "RepoMind Phase 1 Infrastructure Verification",
    timestamp: Date.now(),
  };

  const job = await queue.add("dummy-job", testPayload);

  try {
    const result = await job.waitUntilFinished(queueEvents, 10000);
    return {
      success: result === `PROCESSED:${testPayload.jobId}:${testPayload.message}`,
      result: String(result),
    };
  } catch (err) {
    return {
      success: false,
      result: String(err),
    };
  } finally {
    await worker.close();
    await queue.close();
    await queueEvents.close();
  }
}
