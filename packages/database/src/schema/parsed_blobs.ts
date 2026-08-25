import { pgTable, uuid, text, timestamp, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { gitBlobs } from "./git_blobs";

export const parsedBlobStatusEnum = pgEnum("parsed_blob_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);

export const parsedBlobs = pgTable(
  "parsed_blobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blobSha: text("blob_sha")
      .notNull()
      .references(() => gitBlobs.blobSha, { onDelete: "cascade" }),
    parserVersion: text("parser_version").notNull(),
    chunkerVersion: text("chunker_version").notNull(),
    status: parsedBlobStatusEnum("status").default("PENDING").notNull(),
    claimToken: uuid("claim_token"), // Random unique claim token per execution attempt
    claimedBy: text("claimed_by"),   // Worker ID
    claimedAt: timestamp("claimed_at"),
    leaseUntil: timestamp("lease_until"), // Expiration timestamp for lease/heartbeat
    errorDetails: text("error_details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_parsed_blobs_unique").on(table.blobSha, table.parserVersion, table.chunkerVersion),
    index("idx_parsed_blobs_status_lease").on(table.status, table.leaseUntil),
  ]
);

export type ParsedBlob = typeof parsedBlobs.$inferSelect;
export type NewParsedBlob = typeof parsedBlobs.$inferInsert;
