import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

export function createDbClient(connectionString?: string) {
  const url = connectionString || process.env.DATABASE_URL || "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  const queryClient = postgres(url);
  const db = drizzle(queryClient, { schema });
  return { db, sql: queryClient };
}

export async function checkDatabaseConnection(connectionString?: string): Promise<boolean> {
  const url = connectionString || process.env.DATABASE_URL || "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  const sql = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    const result = await sql`SELECT 1 as connected`;
    return result.length > 0 && result[0].connected === 1;
  } catch (error) {
    return false;
  } finally {
    await sql.end();
  }
}

export async function checkPgVectorExtension(connectionString?: string): Promise<boolean> {
  const url = connectionString || process.env.DATABASE_URL || "postgresql://repomind:repomind_pass@localhost:5432/repomind_db";
  const sql = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    const result = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    return result.length > 0 && result[0].extname === "vector";
  } catch (error) {
    return false;
  } finally {
    await sql.end();
  }
}
