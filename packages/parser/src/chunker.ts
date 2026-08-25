import type { ExtractedSymbol } from "./extractors/typescript.js";
import { generateFallbackChunks, generateLengthDelimitedChunkHash, type GeneratedChunk } from "./fallback.js";

export function generateSymbolChunks(blobSha: string, content: string, symbols: ExtractedSymbol[]): GeneratedChunk[] {
  if (symbols.length === 0) {
    return generateFallbackChunks(blobSha, content);
  }

  const chunks: GeneratedChunk[] = [];
  const lines = content.split("\n");

  for (const sym of symbols) {
    const lineCount = sym.endLine - sym.startLine + 1;
    const byteCount = Buffer.byteLength(sym.content, "utf-8");

    if (lineCount <= 100 && byteCount <= 2000) {
      const chunkHash = generateLengthDelimitedChunkHash(
        blobSha,
        sym.name,
        sym.startLine,
        sym.endLine,
        sym.content
      );

      chunks.push({
        symbolName: sym.name,
        startLine: sym.startLine,
        endLine: sym.endLine,
        content: sym.content,
        chunkHash,
      });
    } else {
      // Sub-chunk oversized symbol (80 lines, 10 lines overlap)
      const symLines = sym.content.split("\n");
      const subWindowSize = 80;
      const subOverlap = 10;
      const step = subWindowSize - subOverlap;

      for (let j = 0; j < symLines.length; j += step) {
        const subChunkLines = symLines.slice(j, j + subWindowSize);
        if (subChunkLines.length === 0) break;

        const subStart = sym.startLine + j;
        const subEnd = Math.min(sym.startLine + j + subChunkLines.length - 1, sym.endLine);
        const subContent = subChunkLines.join("\n");
        const subSymbolName = `${sym.name} [part ${j / step + 1}]`;

        const chunkHash = generateLengthDelimitedChunkHash(
          blobSha,
          subSymbolName,
          subStart,
          subEnd,
          subContent
        );

        chunks.push({
          symbolName: subSymbolName,
          startLine: subStart,
          endLine: subEnd,
          content: subContent,
          chunkHash,
        });

        if (subEnd >= sym.endLine) break;
      }
    }
  }

  return chunks;
}
