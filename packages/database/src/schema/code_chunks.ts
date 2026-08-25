import { pgTable, uuid, text, integer, timestamp, index, customType } from "drizzle-orm/pg-core";
import { repositories } from "./repositories";

// Provisional vector column type declaration for pgvector integration in Phase 4.
// Note: Final dimension specification will be determined during Phase 4 model selection.
const provisionalVector = customType<{ data: number[] }>({
  dataType() {
    return "vector";
  },
});

export const codeChunks = pgTable(
  "code_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha").notNull(),
    filePath: text("file_path").notNull(),
    blobSha: text("blob_sha").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    content: text("content").notNull(),
    embedding: provisionalVector("embedding"), // Provisional column for Phase 4
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_code_chunks_repo_commit").on(table.repositoryId, table.commitSha),
    index("idx_code_chunks_repo_file").on(table.repositoryId, table.filePath),
  ]
);

export type CodeChunk = typeof codeChunks.$inferSelect;
export type NewCodeChunk = typeof codeChunks.$inferInsert;
