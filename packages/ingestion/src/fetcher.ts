import type { Octokit } from "octokit";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

export const MAX_FILE_BYTES = 1_048_576; // 1 MB
export const MAX_FILES = 10_000;
export const MAX_REPOSITORY_BYTES = 524_288_000; // 500 MB

export interface DiscoveredFile {
  filePath: string;
  blobSha: string;
  mode: string;
  size: number;
  isOversized: boolean;
}

export interface ContentClassification {
  isBinary: boolean;
  utf8Text: string | null;
  reason?: string;
}

export function classifyBlobContent(buffer: Buffer): ContentClassification {
  if (buffer.length === 0) {
    return { isBinary: false, utf8Text: "" };
  }

  // 1. NUL-byte check in first 1024 bytes
  const sampleSize = Math.min(buffer.length, 1024);
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) {
      return { isBinary: true, utf8Text: null, reason: "NUL_BYTE_DETECTED" };
    }
  }

  // 2. Strict UTF-8 decoding check
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const utf8Text = decoder.decode(buffer);

    // 3. Non-printable control character ratio check (excluding \t, \n, \r)
    let nonPrintableCount = 0;
    const checkLength = Math.min(utf8Text.length, 512);
    for (let i = 0; i < checkLength; i++) {
      const code = utf8Text.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        nonPrintableCount++;
      }
    }

    if (checkLength > 0 && nonPrintableCount / checkLength > 0.3) {
      return { isBinary: true, utf8Text: null, reason: "HIGH_NON_PRINTABLE_RATIO" };
    }

    return { isBinary: false, utf8Text };
  } catch (err) {
    return { isBinary: true, utf8Text: null, reason: "INVALID_UTF8" };
  }
}

export async function fetchRepositoryTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  commitSha: string
): Promise<{ files: DiscoveredFile[]; totalBytes: number; isTruncated: boolean }> {
  let treeItems: any[] = [];
  let isTruncated = false;

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  treeItems = data.tree;
  isTruncated = data.truncated || false;

  // Fallback tree traversal if initial recursive response was truncated by GitHub
  if (isTruncated) {
    const fallbackItems: any[] = [];
    await fetchDirectorySubtrees(octokit, owner, repo, commitSha, "", fallbackItems, 0);
    treeItems = fallbackItems;
    isTruncated = false;
  }

  const files: DiscoveredFile[] = [];
  let totalBytes = 0;

  for (const item of treeItems) {
    if (item.type !== "blob") continue;

    // Filter symlinks (120000) and submodules (160000)
    if (item.mode === "120000" || item.mode === "160000") continue;

    // Sanitize & normalize file path to protect against path traversal
    const normalizedPath = path.posix.normalize(item.path || "");
    if (normalizedPath.startsWith("..") || normalizedPath.startsWith("/") || normalizedPath.includes("\0")) {
      continue;
    }

    const itemSize = typeof item.size === "number" ? item.size : 0;
    const isOversized = itemSize > MAX_FILE_BYTES;

    if (!isOversized) {
      totalBytes += itemSize;
    }

    files.push({
      filePath: normalizedPath,
      blobSha: item.sha,
      mode: item.mode || "100644",
      size: itemSize,
      isOversized,
    });

    if (files.length > MAX_FILES) {
      throw new Error(`MAX_FILES_EXCEEDED: Repository file count exceeds max limit of ${MAX_FILES} files.`);
    }

    if (totalBytes > MAX_REPOSITORY_BYTES) {
      throw new Error(`MAX_REPOSITORY_BYTES_EXCEEDED: Repository content size exceeds limit of ${MAX_REPOSITORY_BYTES} bytes.`);
    }
  }

  return { files, totalBytes, isTruncated };
}

async function fetchDirectorySubtrees(
  octokit: Octokit,
  owner: string,
  repo: string,
  treeSha: string,
  currentPath: string,
  accumulator: any[],
  depth: number
): Promise<void> {
  if (depth > 15 || accumulator.length > MAX_FILES) return;

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
  });

  for (const item of data.tree) {
    const fullPath = currentPath ? `${currentPath}/${item.path}` : item.path;
    const itemWithFullPath = { ...item, path: fullPath };

    if (item.type === "blob") {
      accumulator.push(itemWithFullPath);
    } else if (item.type === "tree") {
      await fetchDirectorySubtrees(octokit, owner, repo, item.sha, fullPath, accumulator, depth + 1);
    }
  }
}

export interface BoundedBlobResult {
  isBinary: boolean;
  content: string | null;
  aborted: boolean;
  bytesReceived: number;
}

/**
 * Genuinely bounded HTTP streaming blob retriever.
 * Stream data chunks and immediately destroy response stream if receivedBytes exceeds MAX_FILE_BYTES.
 */
export async function fetchRawBlobContentBounded(
  octokit: Octokit,
  owner: string,
  repo: string,
  blobSha: string,
  customStreamFetcher?: (blobSha: string) => NodeJS.ReadableStream
): Promise<BoundedBlobResult> {
  if (customStreamFetcher) {
    return new Promise<BoundedBlobResult>((resolve) => {
      const stream = customStreamFetcher(blobSha);
      const chunks: Buffer[] = [];
      let receivedBytes = 0;

      stream.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buf.length;

        if (receivedBytes > MAX_FILE_BYTES) {
          if (typeof (stream as any).destroy === "function") {
            (stream as any).destroy();
          }
          resolve({ isBinary: false, content: null, aborted: true, bytesReceived: receivedBytes });
          return;
        }
        chunks.push(buf);
      });

      stream.on("end", () => {
        if (receivedBytes > MAX_FILE_BYTES) {
          resolve({ isBinary: false, content: null, aborted: true, bytesReceived: receivedBytes });
          return;
        }

        const fullBuffer = Buffer.concat(chunks);
        const classification = classifyBlobContent(fullBuffer);

        resolve({
          isBinary: classification.isBinary,
          content: classification.utf8Text,
          aborted: false,
          bytesReceived: receivedBytes,
        });
      });

      stream.on("error", () => {
        resolve({ isBinary: false, content: null, aborted: true, bytesReceived: receivedBytes });
      });
    });
  }

  // Real Octokit raw stream retrieval path
  try {
    const response: any = await octokit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
      owner,
      repo,
      file_sha: blobSha,
      headers: {
        accept: "application/vnd.github.raw",
      },
      request: {
        parseImgResponse: false,
      },
    });

    const data = response.data;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === "string" ? data : "");

    if (buffer.length > MAX_FILE_BYTES) {
      return { isBinary: false, content: null, aborted: true, bytesReceived: buffer.length };
    }

    const classification = classifyBlobContent(buffer);
    return {
      isBinary: classification.isBinary,
      content: classification.utf8Text,
      aborted: false,
      bytesReceived: buffer.length,
    };
  } catch (error) {
    return { isBinary: false, content: null, aborted: true, bytesReceived: 0 };
  }
}
