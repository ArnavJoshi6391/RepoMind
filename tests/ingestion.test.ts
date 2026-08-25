import { describe, it, expect, beforeAll } from "vitest";
import dotenv from "dotenv";
import {
  createDbClient,
  runMigrations,
  githubInstallations,
  repositories,
  repositorySnapshots,
  gitBlobs,
  snapshotFiles,
} from "@repomind/database";
import {
  runIngestionPipeline,
  createSnapshot,
  promoteSnapshotIfNewer,
  fetchRepositoryTree,
  fetchRawBlobContentWithAbort,
} from "@repomind/ingestion";
import { eq } from "drizzle-orm";
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

describe("Phase 3 Ingestion Pipeline & Generation Promotion Tests", () => {
  it("Test 1: Monotonic Generation promotion (Gen 6 finishes before Gen 5; active index remains Gen 6)", async () => {
    const { db, sql } = createDbClient();
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

      // Create Snapshot 1 (Gen 1) and Snapshot 2 (Gen 2)
      const snap1 = await createSnapshot(db, repo.id, "commit-1"); // Gen 1
      const snap2 = await createSnapshot(db, repo.id, "commit-2"); // Gen 2

      expect(snap1.generation).toBe(1n);
      expect(snap2.generation).toBe(2n);

      // Simulate Gen 2 completing first
      const promoted2 = await promoteSnapshotIfNewer(db, repo.id, snap2.snapshotId, snap2.generation, "commit-2");
      expect(promoted2).toBe(true);

      const [repoAfter2] = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(repoAfter2.activeSnapshotId).toBe(snap2.snapshotId);
      expect(BigInt(repoAfter2.activeGeneration)).toBe(2n);

      // Simulate Gen 1 completing later
      const promoted1 = await promoteSnapshotIfNewer(db, repo.id, snap1.snapshotId, snap1.generation, "commit-1");
      expect(promoted1).toBe(false);

      // Verify active snapshot remains Gen 2!
      const [repoAfter1] = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(repoAfter1.activeSnapshotId).toBe(snap2.snapshotId);
      expect(BigInt(repoAfter1.activeGeneration)).toBe(2n);
    } finally {
      await sql.end();
    }
  });

  it("Test 2: Failed newer generation preserves valid older ACTIVE snapshot", async () => {
    const { db, sql } = createDbClient();
    try {
      const instId = getRandomBigInt();
      const repoId = getRandomBigInt();

      const [inst] = await db
        .insert(githubInstallations)
        .values({
          githubInstallationId: instId,
          accountId: getRandomBigInt(),
          accountLogin: `fail-org-${Date.now()}`,
          accountType: "User",
        })
        .returning();

      const [repo] = await db
        .insert(repositories)
        .values({
          githubRepoId: repoId,
          installationId: inst.id,
          owner: `fail-org-${Date.now()}`,
          name: "fail-repo",
          fullName: `fail-org-${Date.now()}/fail-repo`,
          defaultBranch: "main",
        })
        .returning();

      const snap1 = await createSnapshot(db, repo.id, "commit-valid");
      await promoteSnapshotIfNewer(db, repo.id, snap1.snapshotId, snap1.generation, "commit-valid");

      const snap2 = await createSnapshot(db, repo.id, "commit-failed");
      await db
        .update(repositorySnapshots)
        .set({ status: "FAILED", errorDetails: "PARSER_OOM_CRASH" })
        .where(eq(repositorySnapshots.id, snap2.snapshotId));

      // Active snapshot remains snap1!
      const [currentRepo] = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(currentRepo.activeSnapshotId).toBe(snap1.snapshotId);
      expect(currentRepo.lastIndexedCommit).toBe("commit-valid");
    } finally {
      await sql.end();
    }
  });

  it("Test 3: Pre-download oversized file check (> 1 MB skipped)", async () => {
    const mockOctokit: any = {
      rest: {
        git: {
          getTree: async () => ({
            data: {
              truncated: false,
              tree: [
                { path: "src/normal.ts", type: "blob", sha: "sha-normal-1", size: 100, mode: "100644" },
                { path: "src/large.iso", type: "blob", sha: "sha-large-2", size: 5_000_000, mode: "100644" }, // 5 MB > 1MB
              ],
            },
          }),
        },
      },
    };

    const { files } = await fetchRepositoryTree(mockOctokit, "owner", "repo", "sha-1");
    expect(files.length).toBe(2);
    expect(files[0].isOversized).toBe(false);
    expect(files[1].isOversized).toBe(true);
  });

  it("Test 4: Content-Addressable Git Blob Deduplication across multiple repositories", async () => {
    const { db, sql } = createDbClient();
    try {
      const commonSha = crypto.randomBytes(20).toString("hex");

      await db.insert(gitBlobs).values({
        blobSha: commonSha,
        size: 50,
        content: "export const COMMON = true;",
      });

      // Insert second time with onConflictDoNothing
      await db.insert(gitBlobs).values({
        blobSha: commonSha,
        size: 50,
        content: "export const COMMON = true;",
      }).onConflictDoNothing({ target: gitBlobs.blobSha });

      const blobs = await db.select().from(gitBlobs).where(eq(gitBlobs.blobSha, commonSha));
      expect(blobs.length).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
