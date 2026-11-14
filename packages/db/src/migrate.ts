import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index.ts";

export async function migrateDb(databaseUrl: string) {
  const db = createDb(databaseUrl);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
  } finally {
    await db.$client.end();
  }
}
