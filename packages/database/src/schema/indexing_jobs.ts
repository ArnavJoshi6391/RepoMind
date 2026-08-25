import { pgTable, uuid, text, timestamp, pgEnum, integer, index } from "drizzle-orm/pg-core";
import { repositories } from "./repositories";

export const indexingJobStatusEnum = pgEnum("indexing_job_status", ["pending", "processing", "completed", "failed"]);

export const indexingJobs = pgTable(
  "indexing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    requestedRef: text("requested_ref").notNull(),
    status: indexingJobStatusEnum("status").default("pending").notNull(),
    errorDetails: text("error_details"),
    retryCount: integer("retry_count").default(0).notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_indexing_jobs_repo_status").on(table.repositoryId, table.status),
  ]
);

export type IndexingJob = typeof indexingJobs.$inferSelect;
export type NewIndexingJob = typeof indexingJobs.$inferInsert;
