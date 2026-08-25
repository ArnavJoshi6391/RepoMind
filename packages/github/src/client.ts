import type { Octokit } from "octokit";

export interface RepositoryMetadata {
  githubRepoId: bigint;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
}

export async function fetchRepositoryMetadata(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RepositoryMetadata> {
  const { data } = await octokit.rest.repos.get({
    owner,
    repo,
  });

  return {
    githubRepoId: BigInt(data.id),
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    defaultBranch: data.default_branch, // Dynamic default branch from GitHub metadata (main, master, develop, etc.)
    isPrivate: data.private,
    description: data.description ?? null,
  };
}
