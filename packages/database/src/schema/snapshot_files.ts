import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { repositorySnapshots } from "./repository_snapshots";
import { gitBlobs } from "./git_blobs";

export const snapshotFiles = pgTable(
  "snapshot_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repositorySnapshots.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    blobSha: text("blob_sha")
      .notNull()
      .references(() => gitBlobs.blobSha, { onDelete: "cascade" }),
    mode: text("mode").notNull(), // e.g. '100644', '120000', '160000'
    size: integer("size").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_snapshot_files_unique").on(table.snapshotId, table.filePath),
    index("idx_snapshot_files_snapshot_blob").on(table.snapshotId, table.blobSha),
  ]
);

export type SnapshotFile = typeof snapshotFiles.$inferSelect;
export type NewSnapshotFile = typeof snapshotFiles.$inferInsert;
