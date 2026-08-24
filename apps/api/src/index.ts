import { buildApp } from "./app.js";
import { config } from "./config.js";

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`RepoMind API listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
