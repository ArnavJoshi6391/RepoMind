import { pgTable, uuid, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const gitBlobs = pgTable(
  "git_blobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blobSha: text("blob_sha").notNull().unique(), // Git content-addressable SHA hash
    size: integer("size").notNull(),
    content: text("content").notNull(),
    isBinary: boolean("is_binary").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_git_blobs_sha").on(table.blobSha),
  ]
);

export type GitBlob = typeof gitBlobs.$inferSelect;
export type NewGitBlob = typeof gitBlobs.$inferInsert;
