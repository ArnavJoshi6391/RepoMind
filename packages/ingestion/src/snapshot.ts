import { repositories, repositorySnapshots } from "@repomind/database";
import { eq, sql } from "drizzle-orm";

export interface SnapshotCreationResult {
  snapshotId: string;
  generation: bigint;
}

export async function createSnapshot(
  db: any,
  repositoryId: string,
  commitSha: string
): Promise<SnapshotCreationResult> {
  // Atomically increment repositories.nextGeneration
  const [updatedRepo] = await db
    .update(repositories)
    .set({
      nextGeneration: sql`${repositories.nextGeneration} + 1::bigint`,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId))
    .returning({ generation: repositories.nextGeneration });

  const assignedGen = updatedRepo ? BigInt(updatedRepo.generation) - 1n : 1n;

  const [snapshot] = await db
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

export async function promoteSnapshotIfNewer(
  db: any,
  repositoryId: string,
  snapshotId: string,
  generation: bigint,
  commitSha: string
): Promise<boolean> {
  // Database Promotion Invariants:
  // 1. Snapshot status updated to READY
  await db
    .update(repositorySnapshots)
    .set({ status: "READY", completedAt: new Date() })
    .where(eq(repositorySnapshots.id, snapshotId));

  // 2. Promotion to ACTIVE occurs ONLY if generation > active_generation
  const [promotedRepo] = await db
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

  if (promotedRepo) {
    await db
      .update(repositorySnapshots)
      .set({ status: "ACTIVE" })
      .where(eq(repositorySnapshots.id, snapshotId));

    return true;
  }

  return false;
}
