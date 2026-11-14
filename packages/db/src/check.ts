import { sql } from "drizzle-orm";
import { createDb } from "./index.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const db = createDb(databaseUrl);
const result = await db.execute(sql`select now() as time, current_user as who`);
console.log(result);
process.exit(0);
