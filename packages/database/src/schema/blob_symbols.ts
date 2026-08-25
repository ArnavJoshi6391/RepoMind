import { pgTable, uuid, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { gitBlobs } from "./git_blobs";

export const symbolKindEnum = pgEnum("symbol_kind", ["function", "class", "interface", "variable", "method", "type"]);

export const blobSymbols = pgTable(
  "blob_symbols",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blobSha: text("blob_sha")
      .notNull()
      .references(() => gitBlobs.blobSha, { onDelete: "cascade" }),
    parserVersion: text("parser_version").notNull(),
    name: text("name").notNull(),
    kind: symbolKindEnum("kind").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    containerName: text("container_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_blob_symbols_sha_ver").on(table.blobSha, table.parserVersion),
    index("idx_blob_symbols_name").on(table.name),
  ]
);

export type BlobSymbol = typeof blobSymbols.$inferSelect;
export type NewBlobSymbol = typeof blobSymbols.$inferInsert;
