import { describe, it, expect, beforeAll } from "vitest";
import dotenv from "dotenv";
import {
  createDbClient,
  runMigrations,
  githubInstallations,
  repositories,
  indexingJobs,
  codeChunks,
  symbols,
} from "@repomind/database";
import { eq } from "drizzle-orm";

beforeAll(async () => {
  dotenv.config();
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  }
  await runMigrations();
});

describe("Phase 2 Domain Model & Schema Verification", () => {
  it("should create github_installations and associated repositories with precision-safe bigint IDs", async () => {
    const { db, sql } = createDbClient();
    try {
      const installationIdNum = BigInt("998877665544332211");
      const repoIdNum = BigInt("887766554433221100");

      const [inst] = await db
        .insert(githubInstallations)
        .values({
          githubInstallationId: installationIdNum,
          accountId: BigInt("123456789"),
          accountLogin: "test-org",
          accountType: "Organization",
        })
        .returning();

      expect(inst.id).toBeDefined();
      expect(inst.githubInstallationId).toBe(installationIdNum);

      // Verify non-main default branch (develop) is persisted dynamically without database default fallback
      const [repo] = await db
        .insert(repositories)
        .values({
          githubRepoId: repoIdNum,
          installationId: inst.id,
          owner: "test-org",
          name: "test-repo",
          fullName: "test-org/test-repo",
          defaultBranch: "develop", // Custom non-main default branch
          status: "active",
        })
        .returning();

      expect(repo.id).toBeDefined();
      expect(repo.defaultBranch).toBe("develop");
      expect(repo.githubRepoId).toBe(repoIdNum);
    } finally {
      await sql.end();
    }
  });

  it("should cascade delete repositories when parent github_installation is deleted", async () => {
    const { db, sql } = createDbClient();
    try {
      const instId = BigInt("999111222333");
      const repoId = BigInt("888111222333");

      const [inst] = await db
        .insert(githubInstallations)
        .values({
          githubInstallationId: instId,
          accountId: BigInt("111222333"),
          accountLogin: "cascade-org",
          accountType: "Organization",
        })
        .returning();

      const [repo] = await db
        .insert(repositories)
        .values({
          githubRepoId: repoId,
          installationId: inst.id,
          owner: "cascade-org",
          name: "cascade-repo",
          fullName: "cascade-org/cascade-repo",
          defaultBranch: "master",
        })
        .returning();

      // Delete parent installation
      await db.delete(githubInstallations).where(eq(githubInstallations.id, inst.id));

      // Verify repository was cascade deleted
      const foundRepo = await db.select().from(repositories).where(eq(repositories.id, repo.id));
      expect(foundRepo.length).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("should manage indexing_jobs lifecycle transitions (pending -> processing -> completed)", async () => {
    const { db, sql } = createDbClient();
    try {
      const instId = BigInt("777111222");
      const repoId = BigInt("666111222");

      const [inst] = await db
        .insert(githubInstallations)
        .values({
          githubInstallationId: instId,
          accountId: BigInt("555111222"),
          accountLogin: "job-org",
          accountType: "User",
        })
        .returning();

      const [repo] = await db
        .insert(repositories)
        .values({
          githubRepoId: repoId,
          installationId: inst.id,
          owner: "job-org",
          name: "job-repo",
          fullName: "job-org/job-repo",
          defaultBranch: "main",
        })
        .returning();

      // Create indexing job
      const [job] = await db
        .insert(indexingJobs)
        .values({
          repositoryId: repo.id,
          requestedRef: "refs/heads/main",
          status: "pending",
        })
        .returning();

      expect(job.status).toBe("pending");

      // Update to processing
      await db.update(indexingJobs).set({ status: "processing", startedAt: new Date() }).where(eq(indexingJobs.id, job.id));
      const [processingJob] = await db.select().from(indexingJobs).where(eq(indexingJobs.id, job.id));
      expect(processingJob.status).toBe("processing");

      // Update to completed
      await db.update(indexingJobs).set({ status: "completed", completedAt: new Date() }).where(eq(indexingJobs.id, job.id));
      const [completedJob] = await db.select().from(indexingJobs).where(eq(indexingJobs.id, job.id));
      expect(completedJob.status).toBe("completed");
    } finally {
      await sql.end();
    }
  });
});
