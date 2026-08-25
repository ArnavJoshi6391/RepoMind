import { App, Octokit } from "octokit";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

export function getGitHubAppConfig(): GitHubAppConfig {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!appId || !privateKeyRaw || !webhookSecret) {
    throw new Error("Missing GitHub App environment variables (GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET)");
  }

  // Support base64 encoded private keys
  const privateKey = privateKeyRaw.startsWith("-----BEGIN")
    ? privateKeyRaw
    : Buffer.from(privateKeyRaw, "base64").toString("utf-8");

  return { appId, privateKey, webhookSecret };
}

export function createGitHubApp(config = getGitHubAppConfig()): App {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: {
      secret: config.webhookSecret,
    },
  });
}

export async function getInstallationOctokit(installationId: number | bigint, config = getGitHubAppConfig()): Promise<Octokit> {
  const app = createGitHubApp(config);
  return (await app.getInstallationOctokit(Number(installationId))) as unknown as Octokit;
}
