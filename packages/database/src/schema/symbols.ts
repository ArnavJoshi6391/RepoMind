import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { repositories } from "./repositories";
import { symbolKindEnum } from "./blob_symbols";

export { symbolKindEnum };

export const symbols = pgTable(
  "symbols",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    name: text("name").notNull(),
    kind: symbolKindEnum("kind").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    containerName: text("container_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_symbols_repo_name").on(table.repositoryId, table.name),
    index("idx_symbols_repo_file").on(table.repositoryId, table.filePath),
  ]
);

export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;
