import { migrateDb } from "@relay/db/migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. See .env.example.");
  }
  await migrateDb(url);
}
