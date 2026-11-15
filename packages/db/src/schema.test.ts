import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";
import * as schema from "./schema.ts";

test("every table has a user_id column, unless it is on the allowlist", () => {
  // Tables that are not owned by a user. Adding a name here is a decision
  // that shows up in code review.
  const notUserOwned = ["user", "verification"];

  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const { name, columns } = getTableConfig(value);
    const hasUserId = columns.some((column) => column.name === "user_id");
    expect(
      hasUserId || notUserOwned.includes(name),
      `table "${name}" needs a user_id column, or an entry on the allowlist`,
    ).toBe(true);
  }
});
