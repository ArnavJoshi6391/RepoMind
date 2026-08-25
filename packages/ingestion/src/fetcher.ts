import type { Octokit } from "octokit";
import path from "node:path";

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
) {
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

export async function fetchRawBlobContentWithAbort(
  octokit: Octokit,
  owner: string,
  repo: string,
  blobSha: string
): Promise<string | null> {
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
    if (typeof data === "string") {
      if (Buffer.byteLength(data, "utf-8") > MAX_FILE_BYTES) {
        return null;
      }
      return data;
    }

    if (Buffer.isBuffer(data)) {
      if (data.length > MAX_FILE_BYTES) {
        return null;
      }
      return data.toString("utf-8");
    }

    return null;
  } catch (error) {
    return null;
  }
}
