import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// Load environment variables from root .env or environment
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const databaseUrl = process.env.DATABASE_URL || "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
});
