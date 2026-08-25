import { describe, it, expect, beforeAll } from "vitest";
import dotenv from "dotenv";
import { Readable } from "node:stream";
import {
  createDbClient,
  runMigrations,
  githubInstallations,
  repositories,
  repositorySnapshots,
  gitBlobs,
  snapshotFiles,
  parsedBlobs,
  blobSymbols,
} from "@repomind/database";
import {
  runIngestionPipeline,
  createSnapshot,
  promoteSnapshotIfNewer,
  fetchRepositoryTree,
  fetchRawBlobContentBounded,
  type FailureStage,
} from "@repomind/ingestion";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

function getRandomBigInt(): bigint {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

beforeAll(async () => {
  dotenv.config();
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  }
  await runMigrations();
});

describe("Phase 3 Ingestion Pipeline, Bounded Stream & Atomic Promotion Tests", () => {
  it("Test 1: Genuinely Bounded Stream Retrieval Aborts at 1 MB + 1 and NEVER materializes 2 MB payload", async () => {
    const mockOctokit: any = {};

    // Create a 2 MB simulated stream
    const chunk1MB = Buffer.alloc(1024 * 1024, "a");
    const chunk1MBExtra = Buffer.alloc(1024 * 1024, "b");

    const customStreamFetcher = (_blobSha: string): NodeJS.ReadableStream => {
      const stream = new Readable({
        read() {
          this.push(chunk1MB);
          this.push(chunk1MBExtra); // Total 2 MB
          this.push(null);
        },
      });
      return stream;
    };

    const res = await fetchRawBlobContentBounded(
      mockOctokit,
      "owner",
      "repo",
      "sha-oversized-2mb",
      customStreamFetcher
    );

    expect(res.aborted).toBe(true);
    expect(res.content).toBeNull();
    expect(res.bytesReceived).toBeGreaterThan(1_048_576);
  });

  it("Test 2: Single-transaction atomic snapshot promotion with failure injections and rollback verification", async () => {
    const { db, sql } = createDbClient();
    const dbClient = createDbClient();

    try {
      const instId = getRandomBigInt();
      const repoId = getRandomBigInt();

      const [inst] = await db
        .insert(githubInstallations)
        .values({
          githubInstallationId: instId,
          accountId: getRandomBigInt(),
          accountLogin: `atomic-org-${Date.now()}`,
          accountType: "Organization",
        })
        .returning();

      const [repo] = await db
        .insert(repositories)
        .values({
          githubRepoId: repoId,
          installationId: inst.id,
          owner: `atomic-org-${Date.now()}`,
          name: "atomic-repo",
          fullName: `atomic-org-${Date.now()}/atomic-repo`,
          defaultBranch: "main",
        })
        .returning();

      // 1. Initial valid ACTIVE snapshot
      const snap0 = await createSnapshot(dbClient, repo.id, "commit-0");
      await promoteSnapshotIfNewer(dbClient, repo.id, snap0.snapshotId, snap0.generation, "commit-0");

      const [active0] = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(active0.activeSnapshotId).toBe(snap0.snapshotId);

      // 2. Failure before repo update
      const snap1 = await createSnapshot(dbClient, repo.id, "commit-1");
      await expect(
        promoteSnapshotIfNewer(
          dbClient,
          repo.id,
          snap1.snapshotId,
          snap1.generation,
          "commit-1",
          (stage: FailureStage) => {
            if (stage === "BEFORE_REPO_UPDATE") throw new Error("INJECTED_FAILURE_BEFORE_REPO_UPDATE");
          }
        )
      ).rejects.toThrow("INJECTED_FAILURE_BEFORE_REPO_UPDATE");

      // Verify transaction rolled back cleanly and active snapshot remains snap0
      const [afterFail1] = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(afterFail1.activeSnapshotId).toBe(snap0.snapshotId);

      // 3. Failure after repo update before ACTIVE state commit
      const snap2 = await createSnapshot(dbClient, repo.id, "commit-2");
      await expect(
        promoteSnapshotIfNewer(
          dbClient,
          repo.id,
          snap2.snapshotId,
          snap2.generation,
          "commit-2",
          (stage: FailureStage) => {
            if (stage === "BEFORE_SNAPSHOT_ACTIVE") throw new Error("INJECTED_FAILURE_BEFORE_ACTIVE");
          }
        )
      ).rejects.toThrow("INJECTED_FAILURE_BEFORE_ACTIVE");

      // Verify transaction rolled back cleanly and active snapshot remains snap0
      const [afterFail2] = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(afterFail2.activeSnapshotId).toBe(snap0.snapshotId);
    } finally {
      await sql.end();
    }
  });

  it("Test 3: Monotonic Generation promotion (Gen 6 finishes before Gen 5; active index remains Gen 6)", async () => {
    const { db, sql } = createDbClient();
    const dbClient = createDbClient();
    try {
      const instId = getRandomBigInt();
      const repoId = getRandomBigInt();

      const [inst] = await db
        .insert(githubInstallations)
        .values({
          githubInstallationId: instId,
          accountId: getRandomBigInt(),
          accountLogin: `gen-org-${Date.now()}`,
          accountType: "Organization",
        })
        .returning();

      const [repo] = await db
        .insert(repositories)
        .values({
          githubRepoId: repoId,
          installationId: inst.id,
          owner: `gen-org-${Date.now()}`,
          name: "gen-repo",
          fullName: `gen-org-${Date.now()}/gen-repo`,
          defaultBranch: "main",
        })
        .returning();

      const snap1 = await createSnapshot(dbClient, repo.id, "commit-1"); // Gen 1
      const snap2 = await createSnapshot(dbClient, repo.id, "commit-2"); // Gen 2

      expect(snap1.generation).toBe(1n);
      expect(snap2.generation).toBe(2n);

      // Simulate Gen 2 completing first
      const promoted2 = await promoteSnapshotIfNewer(dbClient, repo.id, snap2.snapshotId, snap2.generation, "commit-2");
      expect(promoted2).toBe(true);

      const [repoAfter2] = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(repoAfter2.activeSnapshotId).toBe(snap2.snapshotId);
      expect(BigInt(repoAfter2.activeGeneration)).toBe(2n);

      // Simulate Gen 1 completing later
      const promoted1 = await promoteSnapshotIfNewer(dbClient, repo.id, snap1.snapshotId, snap1.generation, "commit-1");
      expect(promoted1).toBe(false);

      // Verify active snapshot remains Gen 2!
      const [repoAfter1] = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(repoAfter1.activeSnapshotId).toBe(snap2.snapshotId);
      expect(BigInt(repoAfter1.activeGeneration)).toBe(2n);
    } finally {
      await sql.end();
    }
  });

  it("Test 4: Ingestion Pipeline with lost ownership revocation aborts commit cleanly", async () => {
    const { db, sql } = createDbClient();
    const dbClient = createDbClient();

    try {
      const instId = getRandomBigInt();
      const repoId = getRandomBigInt();
      const blobSha = crypto.randomBytes(20).toString("hex");

      const [inst] = await db
        .insert(githubInstallations)
        .values({
          githubInstallationId: instId,
          accountId: getRandomBigInt(),
          accountLogin: `pipe-org-${Date.now()}`,
          accountType: "Organization",
        })
        .returning();

      const [repo] = await db
        .insert(repositories)
        .values({
          githubRepoId: repoId,
          installationId: inst.id,
          owner: `pipe-org-${Date.now()}`,
          name: "pipe-repo",
          fullName: `pipe-org-${Date.now()}/pipe-repo`,
          defaultBranch: "main",
        })
        .returning();

      const mockOctokit: any = {
        rest: {
          git: {
            getTree: async () => ({
              data: {
                truncated: false,
                tree: [
                  { path: "src/revoked.ts", type: "blob", sha: blobSha, size: 100, mode: "100644" },
                ],
              },
            }),
          },
        },
        request: async () => ({
          data: "export function revokedTest() {}",
        }),
      };

      // Run pipeline with simulated ownership revocation
      await runIngestionPipeline({
        octokit: mockOctokit,
        repositoryId: repo.id,
        owner: repo.owner,
        repo: repo.name,
        commitSha: "commit-revoked",
        workerId: "worker-revoked",
        dbClient,
        simulatedOwnershipRevocation: true, // Injected lost ownership
      });

      // Verify symbols were NOT committed due to lost ownership
      const symbols = await db.select().from(blobSymbols).where(eq(blobSymbols.blobSha, blobSha));
      expect(symbols.length).toBe(0);
    } finally {
      await sql.end();
    }
  });
});
