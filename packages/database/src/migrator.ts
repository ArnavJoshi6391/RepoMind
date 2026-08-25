import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(connectionString?: string) {
  const url = connectionString || process.env.DATABASE_URL || "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  const migrationClient = postgres(url, { max: 1 });
  const db = drizzle(migrationClient);

  const migrationsFolder = path.resolve(__dirname, "./migrations");

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await migrationClient.end();
  }
}
