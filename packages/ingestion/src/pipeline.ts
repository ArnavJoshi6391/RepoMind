import type { Octokit } from "octokit";
import {
  createDbClient,
  gitBlobs,
  parsedBlobs,
  snapshotFiles,
  repositorySnapshots,
  indexingJobs,
} from "@repomind/database";
import { eq, and } from "drizzle-orm";
import {
  PARSER_VERSION,
  CHUNKER_VERSION,
  detectLanguage,
  extractTypeScriptSymbols,
  extractPythonSymbols,
  generateSymbolChunks,
  generateFallbackChunks,
} from "@repomind/parser";
import { fetchRepositoryTree, fetchRawBlobContentWithAbort } from "./fetcher.js";
import { createSnapshot, promoteSnapshotIfNewer } from "./snapshot.js";
import { claimBlobParsing, completeBlobParsing } from "./claim.js";

export interface IngestionOptions {
  octokit: Octokit;
  repositoryId: string;
  owner: string;
  repo: string;
  commitSha: string;
  workerId?: string;
  dbClient?: any;
}

export async function runIngestionPipeline(options: IngestionOptions): Promise<{
  snapshotId: string;
  generation: bigint;
  promoted: boolean;
  totalFiles: number;
  parsedFiles: number;
  reusedBlobs: number;
}> {
  const workerId = options.workerId || `worker-${process.pid}`;
  const dbClient = options.dbClient || createDbClient();
  const { db } = dbClient;

  // Step 1: Create repository snapshot with assigned generation counter
  const { snapshotId, generation } = await createSnapshot(db, options.repositoryId, options.commitSha);

  await db
    .update(repositorySnapshots)
    .set({ status: "PROCESSING" })
    .where(eq(repositorySnapshots.id, snapshotId));

  let totalFiles = 0;
  let parsedFiles = 0;
  let reusedBlobs = 0;

  try {
    // Step 2: Fetch tree from GitHub
    const { files, isTruncated } = await fetchRepositoryTree(
      options.octokit,
      options.owner,
      options.repo,
      options.commitSha
    );

    if (isTruncated) {
      throw new Error("GITHUB_TREE_TRUNCATED: Repository tree was truncated and fallback limits were exceeded.");
    }

    totalFiles = files.length;

    // Step 3: Process files and store in content-addressable storage
    for (const file of files) {
      // Check if blob content exists in git_blobs
      const [existingBlob] = await db
        .select()
        .from(gitBlobs)
        .where(eq(gitBlobs.blobSha, file.blobSha))
        .limit(1);

      if (!existingBlob && !file.isOversized) {
        // Fetch raw blob content safely
        const content = await fetchRawBlobContentWithAbort(
          options.octokit,
          options.owner,
          options.repo,
          file.blobSha
        );

        if (content !== null) {
          await db
            .insert(gitBlobs)
            .values({
              blobSha: file.blobSha,
              size: file.size,
              content,
              isBinary: false,
            })
            .onConflictDoNothing({ target: gitBlobs.blobSha });
        } else {
          // Binary or oversized payload
          await db
            .insert(gitBlobs)
            .values({
              blobSha: file.blobSha,
              size: file.size,
              content: "",
              isBinary: true,
            })
            .onConflictDoNothing({ target: gitBlobs.blobSha });
        }
      }

      // Record file mapping in snapshot_files
      await db.insert(snapshotFiles).values({
        snapshotId,
        filePath: file.filePath,
        blobSha: file.blobSha,
        mode: file.mode,
        size: file.size,
      });

      // Step 4: Check if parsed_blobs cache exists for this blob + parser version
      const [existingParsed] = await db
        .select()
        .from(parsedBlobs)
        .where(
          and(
            eq(parsedBlobs.blobSha, file.blobSha),
            eq(parsedBlobs.parserVersion, PARSER_VERSION),
            eq(parsedBlobs.chunkerVersion, CHUNKER_VERSION),
            eq(parsedBlobs.status, "COMPLETED")
          )
        )
        .limit(1);

      if (existingParsed) {
        reusedBlobs++;
        continue;
      }

      // Step 5: Claim blob parsing atomically
      if (!file.isOversized) {
        const claim = await claimBlobParsing(
          db,
          file.blobSha,
          PARSER_VERSION,
          CHUNKER_VERSION,
          workerId
        );

        if (claim.claimed) {
          const [blob] = await db
            .select()
            .from(gitBlobs)
            .where(eq(gitBlobs.blobSha, file.blobSha))
            .limit(1);

          if (blob && !blob.isBinary && blob.content) {
            const lang = detectLanguage(file.filePath);
            let symbols: any[] = [];
            let chunks: any[] = [];

            if (lang === "typescript" || lang === "javascript") {
              symbols = extractTypeScriptSymbols(blob.content);
              chunks = generateSymbolChunks(file.blobSha, blob.content, symbols);
            } else if (lang === "python") {
              symbols = extractPythonSymbols(blob.content);
              chunks = generateSymbolChunks(file.blobSha, blob.content, symbols);
            } else {
              chunks = generateFallbackChunks(file.blobSha, blob.content);
            }

            // Step 6: Complete blob parsing with ownership token validation
            const committed = await completeBlobParsing(
              db,
              file.blobSha,
              PARSER_VERSION,
              CHUNKER_VERSION,
              claim.claimToken,
              symbols,
              chunks
            );

            if (committed) {
              parsedFiles++;
            }
          }
        }
      }
    }

    // Step 7: Promote snapshot to canonical ACTIVE status if generation is newer
    const promoted = await promoteSnapshotIfNewer(
      db,
      options.repositoryId,
      snapshotId,
      generation,
      options.commitSha
    );

    return {
      snapshotId,
      generation,
      promoted,
      totalFiles,
      parsedFiles,
      reusedBlobs,
    };
  } catch (error: any) {
    // Failure handling: Mark snapshot as FAILED
    await db
      .update(repositorySnapshots)
      .set({
        status: "FAILED",
        errorDetails: error.message || String(error),
      })
      .where(eq(repositorySnapshots.id, snapshotId));

    throw error;
  }
}
