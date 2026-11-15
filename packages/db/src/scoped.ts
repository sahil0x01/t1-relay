import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "./index.ts";
import { run } from "./schema.ts";

export function scopedDb(db: Db, userId: string) {
  return {
    runs: {
      async list({ limit, cursor }: { limit: number; cursor?: string }) {
        const rows = await db
          .select()
          .from(run)
          .where(
            and(
              eq(run.userId, userId),
              cursor ? lt(run.id, cursor) : undefined,
            ),
          )
          .orderBy(desc(run.id))
          .limit(limit + 1);

        const items = rows.slice(0, limit);
        const last = items.at(-1);
        const nextCursor = rows.length > limit && last ? last.id : null;
        return { items, nextCursor };
      },

      async create(input: {
        prompt: string;
        repo: string;
        branch: string;
        model: string;
      }) {
        const [created] = await db
          .insert(run)
          .values({ ...input, userId })
          .returning();
        if (!created) throw new Error("insert returned no row");
        return created;
      },
    },
  };
}
