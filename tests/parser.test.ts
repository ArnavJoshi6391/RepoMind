import { describe, it, expect, beforeAll } from "vitest";
import dotenv from "dotenv";
import {
  createDbClient,
  runMigrations,
  gitBlobs,
  parsedBlobs,
  blobSymbols,
  blobChunks,
} from "@repomind/database";
import {
  claimBlobParsing,
  renewBlobClaimLease,
  completeBlobParsing,
  classifyBlobContent,
} from "@repomind/ingestion";
import {
  extractTypeScriptSymbols,
  extractPythonSymbols,
  generateSymbolChunks,
  generateFallbackChunks,
  PARSER_VERSION,
  CHUNKER_VERSION,
} from "@repomind/parser";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

function getRandomSha(): string {
  return crypto.randomBytes(20).toString("hex");
}

beforeAll(async () => {
  dotenv.config();
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  }
  await runMigrations();
});

describe("Phase 3 Parser, Claims, Heartbeat & Binary Safety Tests", () => {
  it("Test 1: Normal parsed_blob claim protocol", async () => {
    const { db, sql } = createDbClient();
    try {
      const blobSha = getRandomSha();
      await db.insert(gitBlobs).values({ blobSha, size: 100, content: "export function foo() {}" });

      const claim = await claimBlobParsing(db, blobSha, PARSER_VERSION, CHUNKER_VERSION, "worker-1");
      expect(claim.claimed).toBe(true);
      expect(claim.claimToken).toBeDefined();

      const [row] = await db.select().from(parsedBlobs).where(eq(parsedBlobs.blobSha, blobSha));
      expect(row.status).toBe("PROCESSING");
      expect(row.claimedBy).toBe("worker-1");
    } finally {
      await sql.end();
    }
  });

  it("Test 2: Concurrent claim race prevents dual worker processing", async () => {
    const { db, sql } = createDbClient();
    try {
      const blobSha = getRandomSha();
      await db.insert(gitBlobs).values({ blobSha, size: 200, content: "class Bar {}" });

      const res1 = await claimBlobParsing(db, blobSha, PARSER_VERSION, CHUNKER_VERSION, "worker-1");
      const res2 = await claimBlobParsing(db, blobSha, PARSER_VERSION, CHUNKER_VERSION, "worker-2");

      expect(res1.claimed).toBe(true);
      expect(res2.claimed).toBe(false);
    } finally {
      await sql.end();
    }
  });

  it("Test 3: Heartbeat lease renewal extends leaseUntil and prevents premature reclamation", async () => {
    const { db, sql } = createDbClient();
    try {
      const blobSha = getRandomSha();
      await db.insert(gitBlobs).values({ blobSha, size: 150, content: "function test() {}" });

      const claim = await claimBlobParsing(db, blobSha, PARSER_VERSION, CHUNKER_VERSION, "worker-1");
      const renewed = await renewBlobClaimLease(db, blobSha, PARSER_VERSION, CHUNKER_VERSION, claim.claimToken);

      expect(renewed).toBe(true);

      // Attempt by worker 2 to claim active renewed lease should be rejected
      const claim2 = await claimBlobParsing(db, blobSha, PARSER_VERSION, CHUNKER_VERSION, "worker-2");
      expect(claim2.claimed).toBe(false);
    } finally {
      await sql.end();
    }
  });

  it("Test 4: Stale claim recovery after lease expiration", async () => {
    const { db, sql } = createDbClient();
    try {
      const blobSha = getRandomSha();
      await db.insert(gitBlobs).values({ blobSha, size: 150, content: "function stale() {}" });

      // Insert artificially expired lease
      await db.insert(parsedBlobs).values({
        blobSha,
        parserVersion: PARSER_VERSION,
        chunkerVersion: CHUNKER_VERSION,
        status: "PROCESSING",
        claimToken: crypto.randomUUID(),
        claimedBy: "crashed-worker",
        claimedAt: new Date(Date.now() - 10000),
        leaseUntil: new Date(Date.now() - 5000), // Lease expired 5s ago
      });

      // Worker 2 attempts to claim
      const claim2 = await claimBlobParsing(db, blobSha, PARSER_VERSION, CHUNKER_VERSION, "worker-2");
      expect(claim2.claimed).toBe(true);

      const [row] = await db.select().from(parsedBlobs).where(eq(parsedBlobs.blobSha, blobSha));
      expect(row.claimedBy).toBe("worker-2");
    } finally {
      await sql.end();
    }
  });

  it("Test 5: Lost worker ownership prevents COMPLETED commit and rolls back transaction", async () => {
    const { db, sql } = createDbClient();
    try {
      const blobSha = getRandomSha();
      await db.insert(gitBlobs).values({ blobSha, size: 250, content: "export interface User { id: string; }" });

      const claim = await claimBlobParsing(db, blobSha, PARSER_VERSION, CHUNKER_VERSION, "worker-1");

      // Simulate lost ownership by overwriting claimToken (e.g. Worker B reclaimed stale lease)
      await db.update(parsedBlobs).set({ claimToken: crypto.randomUUID() }).where(eq(parsedBlobs.blobSha, blobSha));

      const committed = await completeBlobParsing(
        db,
        blobSha,
        PARSER_VERSION,
        CHUNKER_VERSION,
        claim.claimToken, // Stale claimToken!
        [{ name: "User", kind: "interface", startLine: 1, endLine: 1 }],
        [{ symbolName: "User", startLine: 1, endLine: 1, content: "export interface User", chunkHash: getRandomSha() }]
      );

      expect(committed).toBe(false);

      // Verify symbols were NOT inserted
      const symbols = await db.select().from(blobSymbols).where(eq(blobSymbols.blobSha, blobSha));
      expect(symbols.length).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("Test 6: Binary & UTF-8 Safety Classification & Unicode False-Positive Verification", () => {
    // 1. NUL-byte containing content
    const nulBuf = Buffer.from([0x66, 0x6f, 0x6f, 0x00, 0x62, 0x61, 0x72]);
    const resNul = classifyBlobContent(nulBuf);
    expect(resNul.isBinary).toBe(true);
    expect(resNul.reason).toBe("NUL_BYTE_DETECTED");

    // 2. Invalid UTF-8 bytes
    const invalidUtf8Buf = Buffer.from([0x80, 0x81, 0x82, 0xff]);
    const resInvalid = classifyBlobContent(invalidUtf8Buf);
    expect(resInvalid.isBinary).toBe(true);
    expect(resInvalid.reason).toBe("INVALID_UTF8");

    // 3. Normal UTF-8 source code
    const validUtf8Buf = Buffer.from("export function hello(): string { return 'world'; }");
    const resValid = classifyBlobContent(validUtf8Buf);
    expect(resValid.isBinary).toBe(false);
    expect(resValid.utf8Text).toContain("hello");

    // 4. Unicode source code, non-ASCII comments & Markdown (MUST NOT be classified as binary!)
    const unicodeSourceBuf = Buffer.from(`
// French: Café, Resumé, Spanish: Niño, German: Über
const 变量 = "中文测试";
/* Multilingual Markdown: 日本語, Русский, Emoji 🚀 */
export function greet(name: string): string {
  return \`こんにちは, \${name}!\`;
}
`);
    const resUnicode = classifyBlobContent(unicodeSourceBuf);
    expect(resUnicode.isBinary).toBe(false);
    expect(resUnicode.utf8Text).toContain("Café");
    expect(resUnicode.utf8Text).toContain("中文测试");

    // 5. Binary buffer with high non-printable control character ratio (>30%)
    const nonPrintableBuf = Buffer.from(Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 1 : 2)));
    const resNonPrintable = classifyBlobContent(nonPrintableBuf);
    expect(resNonPrintable.isBinary).toBe(true);
    expect(resNonPrintable.reason).toBe("HIGH_NON_PRINTABLE_RATIO");
  });

  it("Test 7: AST Symbol extraction & chunking for TypeScript and Python", () => {
    const tsCode = `
export class UserService {
  async getUser(id: string) {
    return { id };
  }
}
`;
    const tsSymbols = extractTypeScriptSymbols(tsCode);
    expect(tsSymbols.length).toBeGreaterThan(0);
    expect(tsSymbols[0].name).toBe("UserService");
    expect(tsSymbols[0].kind).toBe("class");

    const chunks = generateSymbolChunks("sha-test", tsCode, tsSymbols);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkHash).toBeDefined();

    const pyCode = `
class Calculator:
    def add(self, a, b):
        return a + b
`;
    const pySymbols = extractPythonSymbols(pyCode);
    expect(pySymbols.length).toBeGreaterThan(0);
    expect(pySymbols[0].name).toBe("Calculator");
  });

  it("Test 8: Multi-version parsing under v1.0.0 and v2.0.0 produces separate artifacts", async () => {
    const { db, sql } = createDbClient();
    try {
      const blobSha = getRandomSha();
      await db.insert(gitBlobs).values({ blobSha, size: 80, content: "function versioned() {}" });

      const claim1 = await claimBlobParsing(db, blobSha, "v1.0.0", "v1.0.0", "worker-1");
      await completeBlobParsing(db, blobSha, "v1.0.0", "v1.0.0", claim1.claimToken, [], []);

      const claim2 = await claimBlobParsing(db, blobSha, "v2.0.0", "v1.0.0", "worker-1");
      await completeBlobParsing(db, blobSha, "v2.0.0", "v1.0.0", claim2.claimToken, [], []);

      const records = await db.select().from(parsedBlobs).where(eq(parsedBlobs.blobSha, blobSha));
      expect(records.length).toBe(2);
    } finally {
      await sql.end();
    }
  });
});
