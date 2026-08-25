import { parsedBlobs, blobSymbols, blobChunks, type NewBlobSymbol, type NewBlobChunk } from "@repomind/database";
import { eq, and, or, lt } from "drizzle-orm";
import crypto from "node:crypto";
import type { ExtractedSymbol } from "@repomind/parser";
import type { GeneratedChunk } from "@repomind/parser";

export interface BlobClaimResult {
  claimed: boolean;
  claimToken: string;
  blobSha: string;
}

export async function claimBlobParsing(
  db: any,
  blobSha: string,
  parserVersion: string,
  chunkerVersion: string,
  workerId: string
): Promise<BlobClaimResult> {
  const claimToken = crypto.randomUUID();
  const leaseDurationMs = 60 * 1000;
  const leaseUntil = new Date(Date.now() + leaseDurationMs);

  try {
    const [claimedRow] = await db
      .insert(parsedBlobs)
      .values({
        blobSha,
        parserVersion,
        chunkerVersion,
        status: "PROCESSING",
        claimToken,
        claimedBy: workerId,
        claimedAt: new Date(),
        leaseUntil,
      })
      .onConflictDoUpdate({
        target: [parsedBlobs.blobSha, parsedBlobs.parserVersion, parsedBlobs.chunkerVersion],
        set: {
          status: "PROCESSING",
          claimToken,
          claimedBy: workerId,
          claimedAt: new Date(),
          leaseUntil,
          updatedAt: new Date(),
        },
        where: or(
          eq(parsedBlobs.status, "PENDING"),
          eq(parsedBlobs.status, "FAILED"),
          and(
            eq(parsedBlobs.status, "PROCESSING"),
            lt(parsedBlobs.leaseUntil, new Date()) // Reclaim stale processing claim
          )
        ),
      })
      .returning({ claimToken: parsedBlobs.claimToken });

    if (claimedRow && claimedRow.claimToken === claimToken) {
      return { claimed: true, claimToken, blobSha };
    }

    return { claimed: false, claimToken: "", blobSha };
  } catch (error) {
    return { claimed: false, claimToken: "", blobSha };
  }
}

export async function renewBlobClaimLease(
  db: any,
  blobSha: string,
  parserVersion: string,
  chunkerVersion: string,
  claimToken: string
): Promise<boolean> {
  const leaseUntil = new Date(Date.now() + 60 * 1000);

  const [updated] = await db
    .update(parsedBlobs)
    .set({ leaseUntil, updatedAt: new Date() })
    .where(
      and(
        eq(parsedBlobs.blobSha, blobSha),
        eq(parsedBlobs.parserVersion, parserVersion),
        eq(parsedBlobs.chunkerVersion, chunkerVersion),
        eq(parsedBlobs.claimToken, claimToken),
        eq(parsedBlobs.status, "PROCESSING")
      )
    )
    .returning({ id: parsedBlobs.id });

  return !!updated;
}

export async function completeBlobParsing(
  db: any,
  blobSha: string,
  parserVersion: string,
  chunkerVersion: string,
  claimToken: string,
  symbols: ExtractedSymbol[],
  chunks: GeneratedChunk[]
): Promise<boolean> {
  try {
    return await db.transaction(async (tx: any) => {
      // Validate ownership claim token before committing artifacts
      const [validated] = await tx
        .update(parsedBlobs)
        .set({
          status: "COMPLETED",
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(parsedBlobs.blobSha, blobSha),
            eq(parsedBlobs.parserVersion, parserVersion),
            eq(parsedBlobs.chunkerVersion, chunkerVersion),
            eq(parsedBlobs.claimToken, claimToken),
            eq(parsedBlobs.status, "PROCESSING")
          )
        )
        .returning({ id: parsedBlobs.id });

      if (!validated) {
        // Lost ownership! Roll back transaction completely without writing symbols or chunks.
        tx.rollback();
        return false;
      }

      if (symbols.length > 0) {
        const symbolValues: NewBlobSymbol[] = symbols.map((s) => ({
          blobSha,
          parserVersion,
          name: s.name,
          kind: s.kind,
          startLine: s.startLine,
          endLine: s.endLine,
          containerName: s.containerName || null,
        }));
        await tx.insert(blobSymbols).values(symbolValues);
      }

      if (chunks.length > 0) {
        const chunkValues: NewBlobChunk[] = chunks.map((c) => ({
          blobSha,
          parserVersion,
          chunkerVersion,
          chunkHash: c.chunkHash,
          symbolName: c.symbolName || null,
          startLine: c.startLine,
          endLine: c.endLine,
          content: c.content,
        }));
        await tx.insert(blobChunks).values(chunkValues).onConflictDoNothing({ target: blobChunks.chunkHash });
      }

      return true;
    });
  } catch (error) {
    return false;
  }
}
