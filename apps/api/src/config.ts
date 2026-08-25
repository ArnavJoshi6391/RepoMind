import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default("3000").transform((val) => parseInt(val, 10)),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000,http://localhost:3001"),
  DATABASE_URL: z.string({ required_error: "DATABASE_URL environment variable is required" }),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.string().default("6379").transform((val) => parseInt(val, 10)),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().default("development_webhook_secret"),
});

export const config = envSchema.parse(process.env);
