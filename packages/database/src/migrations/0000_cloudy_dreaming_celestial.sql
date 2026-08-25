CREATE TYPE "public"."repository_status" AS ENUM('active', 'paused', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."indexing_job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."symbol_kind" AS ENUM('function', 'class', 'interface', 'variable', 'method', 'type');--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_installation_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_github_installation_id_unique" UNIQUE("github_installation_id")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"installation_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"status" "repository_status" DEFAULT 'active' NOT NULL,
	"last_indexed_commit" text,
	"last_indexed_at" timestamp,
	"sync_metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_github_repo_id_unique" UNIQUE("github_repo_id"),
	CONSTRAINT "repositories_full_name_unique" UNIQUE("full_name")
);
--> statement-breakpoint
CREATE TABLE "indexing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"requested_ref" text NOT NULL,
	"status" "indexing_job_status" DEFAULT 'pending' NOT NULL,
	"error_details" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"status" "webhook_delivery_status" DEFAULT 'received' NOT NULL,
	CONSTRAINT "github_webhook_deliveries_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "code_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"file_path" text NOT NULL,
	"blob_sha" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"name" text NOT NULL,
	"kind" "symbol_kind" NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"container_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexing_jobs" ADD CONSTRAINT "indexing_jobs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_github_installations_installation_id" ON "github_installations" USING btree ("github_installation_id");--> statement-breakpoint
CREATE INDEX "idx_repositories_installation_id" ON "repositories" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "idx_repositories_full_name" ON "repositories" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "idx_indexing_jobs_repo_status" ON "indexing_jobs" USING btree ("repository_id","status");--> statement-breakpoint
CREATE INDEX "idx_github_webhook_deliveries_delivery_id" ON "github_webhook_deliveries" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_code_chunks_repo_commit" ON "code_chunks" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE INDEX "idx_code_chunks_repo_file" ON "code_chunks" USING btree ("repository_id","file_path");--> statement-breakpoint
CREATE INDEX "idx_symbols_repo_name" ON "symbols" USING btree ("repository_id","name");--> statement-breakpoint
CREATE INDEX "idx_symbols_repo_file" ON "symbols" USING btree ("repository_id","file_path");