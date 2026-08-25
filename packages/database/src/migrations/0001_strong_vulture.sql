CREATE TYPE "public"."parsed_blob_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."snapshot_status" AS ENUM('CREATED', 'PROCESSING', 'READY', 'ACTIVE', 'FAILED');--> statement-breakpoint
CREATE TABLE "git_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_sha" text NOT NULL,
	"size" integer NOT NULL,
	"content" text NOT NULL,
	"is_binary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "git_blobs_blob_sha_unique" UNIQUE("blob_sha")
);
--> statement-breakpoint
CREATE TABLE "parsed_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_sha" text NOT NULL,
	"parser_version" text NOT NULL,
	"chunker_version" text NOT NULL,
	"status" "parsed_blob_status" DEFAULT 'PENDING' NOT NULL,
	"claim_token" uuid,
	"claimed_by" text,
	"claimed_at" timestamp,
	"lease_until" timestamp,
	"error_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_sha" text NOT NULL,
	"parser_version" text NOT NULL,
	"name" text NOT NULL,
	"kind" "symbol_kind" NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"container_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_sha" text NOT NULL,
	"parser_version" text NOT NULL,
	"chunker_version" text NOT NULL,
	"chunk_hash" text NOT NULL,
	"symbol_name" text,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blob_chunks_chunk_hash_unique" UNIQUE("chunk_hash")
);
--> statement-breakpoint
CREATE TABLE "repository_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"generation" bigint NOT NULL,
	"status" "snapshot_status" DEFAULT 'CREATED' NOT NULL,
	"error_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "snapshot_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"blob_sha" text NOT NULL,
	"mode" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "active_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "active_generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "next_generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "parsed_blobs" ADD CONSTRAINT "parsed_blobs_blob_sha_git_blobs_blob_sha_fk" FOREIGN KEY ("blob_sha") REFERENCES "public"."git_blobs"("blob_sha") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_symbols" ADD CONSTRAINT "blob_symbols_blob_sha_git_blobs_blob_sha_fk" FOREIGN KEY ("blob_sha") REFERENCES "public"."git_blobs"("blob_sha") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_chunks" ADD CONSTRAINT "blob_chunks_blob_sha_git_blobs_blob_sha_fk" FOREIGN KEY ("blob_sha") REFERENCES "public"."git_blobs"("blob_sha") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_snapshots" ADD CONSTRAINT "repository_snapshots_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_files" ADD CONSTRAINT "snapshot_files_snapshot_id_repository_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repository_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_files" ADD CONSTRAINT "snapshot_files_blob_sha_git_blobs_blob_sha_fk" FOREIGN KEY ("blob_sha") REFERENCES "public"."git_blobs"("blob_sha") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_git_blobs_sha" ON "git_blobs" USING btree ("blob_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_parsed_blobs_unique" ON "parsed_blobs" USING btree ("blob_sha","parser_version","chunker_version");--> statement-breakpoint
CREATE INDEX "idx_parsed_blobs_status_lease" ON "parsed_blobs" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "idx_blob_symbols_sha_ver" ON "blob_symbols" USING btree ("blob_sha","parser_version");--> statement-breakpoint
CREATE INDEX "idx_blob_symbols_name" ON "blob_symbols" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_blob_chunks_sha_ver" ON "blob_chunks" USING btree ("blob_sha","parser_version","chunker_version");--> statement-breakpoint
CREATE INDEX "idx_blob_chunks_hash" ON "blob_chunks" USING btree ("chunk_hash");--> statement-breakpoint
CREATE INDEX "idx_snapshots_repo_gen" ON "repository_snapshots" USING btree ("repository_id","generation");--> statement-breakpoint
CREATE INDEX "idx_snapshots_repo_commit" ON "repository_snapshots" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_snapshot_files_unique" ON "snapshot_files" USING btree ("snapshot_id","file_path");--> statement-breakpoint
CREATE INDEX "idx_snapshot_files_snapshot_blob" ON "snapshot_files" USING btree ("snapshot_id","blob_sha");