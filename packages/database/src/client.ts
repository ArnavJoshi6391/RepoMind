import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

function getDatabaseUrl(customUrl?: string): string {
  const url = customUrl || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not defined");
  }
  return url;
}

export function createDbClient(connectionString?: string) {
  const url = getDatabaseUrl(connectionString);
  const queryClient = postgres(url);
  const db = drizzle(queryClient, { schema });
  return { db, sql: queryClient };
}

export async function checkDatabaseConnection(connectionString?: string): Promise<boolean> {
  try {
    const url = getDatabaseUrl(connectionString);
    const sql = postgres(url, { max: 1, connect_timeout: 5 });
    try {
      const result = await sql`SELECT 1 as connected`;
      return result.length > 0 && result[0].connected === 1;
    } finally {
      await sql.end();
    }
  } catch (error) {
    return false;
  }
}

export async function checkPgVectorExtension(connectionString?: string): Promise<boolean> {
  try {
    const url = getDatabaseUrl(connectionString);
    const sql = postgres(url, { max: 1, connect_timeout: 5 });
    try {
      const result = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
      return result.length > 0 && result[0].extname === "vector";
    } finally {
      await sql.end();
    }
  } catch (error) {
    return false;
  }
}
