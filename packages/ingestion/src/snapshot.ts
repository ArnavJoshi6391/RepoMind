import { repositories, repositorySnapshots, type RepositorySnapshot } from "@repomind/database";
import { eq, and, sql } from "drizzle-orm";

export interface SnapshotCreationResult {
  snapshotId: string;
  generation: bigint;
}

export type FailureStage = "BEFORE_REPO_UPDATE" | "AFTER_REPO_UPDATE" | "BEFORE_SNAPSHOT_ACTIVE";

export async function createSnapshot(
  dbClient: any,
  repositoryId: string,
  commitSha: string
): Promise<SnapshotCreationResult> {
  const targetDb = dbClient.db || dbClient;

  // Atomically increment repositories.nextGeneration
  const [updatedRepo] = await targetDb
    .update(repositories)
    .set({
      nextGeneration: sql`${repositories.nextGeneration} + 1::bigint`,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId))
    .returning({ generation: repositories.nextGeneration });

  const assignedGen = updatedRepo ? BigInt(updatedRepo.generation) - 1n : 1n;

  const [snapshot] = await targetDb
    .insert(repositorySnapshots)
    .values({
      repositoryId,
      commitSha,
      generation: assignedGen,
      status: "CREATED",
    })
    .returning({ id: repositorySnapshots.id, generation: repositorySnapshots.generation });

  return {
    snapshotId: snapshot.id,
    generation: BigInt(snapshot.generation),
  };
}

/**
 * Truly atomic snapshot promotion inside ONE PostgreSQL transaction.
 * Guarantees atomicity and rolls back if any step or failure occurs.
 */
export async function promoteSnapshotIfNewer(
  dbClient: any,
  repositoryId: string,
  snapshotId: string,
  generation: bigint,
  commitSha: string,
  failureInjector?: (stage: FailureStage) => void
): Promise<boolean> {
  const targetDb = dbClient.db || dbClient;

  return await targetDb.transaction(async (tx: any) => {
    // 1. Verify snapshot belongs to repository
    const [snapshot] = await tx
      .select()
      .from(repositorySnapshots)
      .where(and(eq(repositorySnapshots.id, snapshotId), eq(repositorySnapshots.repositoryId, repositoryId)));

    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found for repository ${repositoryId}`);
    }

    if (failureInjector) failureInjector("BEFORE_REPO_UPDATE");

    // 2. Mark snapshot READY
    await tx
      .update(repositorySnapshots)
      .set({ status: "READY", completedAt: new Date() })
      .where(eq(repositorySnapshots.id, snapshotId));

    if (failureInjector) failureInjector("AFTER_REPO_UPDATE");

    // 3. Conditionally update repository canonical pointer ONLY when new_generation > active_generation
    const [promotedRepo] = await tx
      .update(repositories)
      .set({
        activeSnapshotId: snapshotId,
        activeGeneration: generation,
        lastIndexedCommit: commitSha,
        lastIndexedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        sql`id = ${repositoryId} AND ${generation} > active_generation`
      )
      .returning({ id: repositories.id });

    if (failureInjector) failureInjector("BEFORE_SNAPSHOT_ACTIVE");

    // 4. If repository promotion succeeds: mark snapshot ACTIVE
    if (promotedRepo) {
      await tx
        .update(repositorySnapshots)
        .set({ status: "ACTIVE" })
        .where(eq(repositorySnapshots.id, snapshotId));

      return true;
    }

    // 5. Stale generation: leave snapshot READY
    return false;
  });
}
