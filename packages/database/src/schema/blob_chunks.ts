import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { gitBlobs } from "./git_blobs";

export const blobChunks = pgTable(
  "blob_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blobSha: text("blob_sha")
      .notNull()
      .references(() => gitBlobs.blobSha, { onDelete: "cascade" }),
    parserVersion: text("parser_version").notNull(),
    chunkerVersion: text("chunker_version").notNull(),
    chunkHash: text("chunk_hash").notNull().unique(), // Length-delimited canonical SHA-256
    symbolName: text("symbol_name"),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_blob_chunks_sha_ver").on(table.blobSha, table.parserVersion, table.chunkerVersion),
    index("idx_blob_chunks_hash").on(table.chunkHash),
  ]
);

export type BlobChunk = typeof blobChunks.$inferSelect;
export type NewBlobChunk = typeof blobChunks.$inferInsert;
