import { pgTable, uuid, text, bigint, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { repositories } from "./repositories";

export const snapshotStatusEnum = pgEnum("snapshot_status", ["CREATED", "PROCESSING", "READY", "ACTIVE", "FAILED"]);

export const repositorySnapshots = pgTable(
  "repository_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(), // Monotonic index generation counter
    status: snapshotStatusEnum("status").default("CREATED").notNull(),
    errorDetails: text("error_details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_snapshots_repo_gen").on(table.repositoryId, table.generation),
    index("idx_snapshots_repo_commit").on(table.repositoryId, table.commitSha),
  ]
);

export type RepositorySnapshot = typeof repositorySnapshots.$inferSelect;
export type NewRepositorySnapshot = typeof repositorySnapshots.$inferInsert;
