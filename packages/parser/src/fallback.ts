export interface GeneratedChunk {
  symbolName: string | null;
  startLine: number;
  endLine: number;
  content: string;
  chunkHash: string;
}

import crypto from "node:crypto";
import { PARSER_VERSION, CHUNKER_VERSION } from "./treesitter.js";

export function generateLengthDelimitedChunkHash(
  blobSha: string,
  symbolName: string | null,
  startLine: number,
  endLine: number,
  content: string
): string {
  const symStr = symbolName ?? "";
  const canonicalString = [
    `BLOB:${blobSha.length}:${blobSha}`,
    `PARSER:${PARSER_VERSION.length}:${PARSER_VERSION}`,
    `CHUNKER:${CHUNKER_VERSION.length}:${CHUNKER_VERSION}`,
    `SYM:${symStr.length}:${symStr}`,
    `RANGE:${startLine}-${endLine}`,
    `CONTENT:${Buffer.byteLength(content, "utf-8")}:${content}`,
  ].join(":");

  return crypto.createHash("sha256").update(canonicalString, "utf-8").digest("hex");
}

export function generateFallbackChunks(blobSha: string, content: string): GeneratedChunk[] {
  const lines = content.split("\n");
  if (lines.length === 0 || content.trim().length === 0) {
    return [];
  }

  const chunks: GeneratedChunk[] = [];
  const windowSize = 50;
  const overlap = 10;
  const step = windowSize - overlap;

  for (let i = 0; i < lines.length; i += step) {
    const chunkLines = lines.slice(i, i + windowSize);
    if (chunkLines.length === 0) break;

    const startLine = i + 1;
    const endLine = i + chunkLines.length;
    const chunkContent = chunkLines.join("\n");

    const chunkHash = generateLengthDelimitedChunkHash(
      blobSha,
      null,
      startLine,
      endLine,
      chunkContent
    );

    chunks.push({
      symbolName: null,
      startLine,
      endLine,
      content: chunkContent,
      chunkHash,
    });

    if (endLine >= lines.length) break;
  }

  return chunks;
}
