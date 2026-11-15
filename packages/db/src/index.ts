import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export { schema };

export function createDb(databaseUrl: string) {
  return drizzle(postgres(databaseUrl), { schema });
}

export type Db = ReturnType<typeof createDb>;
export { scopedDb } from "./scoped.ts";
export { removeInstallation, removeProjectsForRepos } from "./system.ts";
