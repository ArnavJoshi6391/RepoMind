import { pgTable, uuid, bigint, text, timestamp, index } from "drizzle-orm/pg-core";

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubInstallationId: bigint("github_installation_id", { mode: "bigint" }).notNull().unique(),
    accountId: bigint("account_id", { mode: "bigint" }).notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(), // 'User' or 'Organization'
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_github_installations_installation_id").on(table.githubInstallationId),
  ]
);

export type GithubInstallation = typeof githubInstallations.$inferSelect;
export type NewGithubInstallation = typeof githubInstallations.$inferInsert;
