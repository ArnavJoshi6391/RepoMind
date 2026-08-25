import { pgTable, uuid, bigint, text, timestamp, pgEnum, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { githubInstallations } from "./github_installations";

export const repositoryStatusEnum = pgEnum("repository_status", ["active", "paused", "archived", "deleted"]);

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubRepoId: bigint("github_repo_id", { mode: "bigint" }).notNull().unique(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => githubInstallations.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull().unique(),
    defaultBranch: text("default_branch").notNull(), // Dynamic default branch from GitHub metadata
    status: repositoryStatusEnum("status").default("active").notNull(),
    activeSnapshotId: uuid("active_snapshot_id"), // Points to canonical ACTIVE snapshot
    activeGeneration: bigint("active_generation", { mode: "bigint" }).default(sql`0`).notNull(),
    nextGeneration: bigint("next_generation", { mode: "bigint" }).default(sql`1`).notNull(),
    lastIndexedCommit: text("last_indexed_commit"),
    lastIndexedAt: timestamp("last_indexed_at"),
    syncMetadata: jsonb("sync_metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_repositories_installation_id").on(table.installationId),
    index("idx_repositories_full_name").on(table.fullName),
  ]
);

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
