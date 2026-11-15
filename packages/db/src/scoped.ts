import { and, asc, desc, eq, lt } from "drizzle-orm";
import type { Db } from "./index.ts";
import { githubInstallation, project, run } from "./schema.ts";

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

      // The run is created on one of the caller's own projects. Returns null
      // when that project does not exist or belongs to someone else.
      async create(input: {
        projectId: string;
        prompt: string;
        model: string;
        branch?: string;
      }) {
        const [found] = await db
          .select()
          .from(project)
          .where(
            and(eq(project.id, input.projectId), eq(project.userId, userId)),
          )
          .limit(1);
        if (!found) return null;

        const [created] = await db
          .insert(run)
          .values({
            userId,
            projectId: found.id,
            repo: found.repoFullName,
            branch: input.branch ?? found.defaultBranch,
            prompt: input.prompt,
            model: input.model,
          })
          .returning();
        if (!created) throw new Error("insert returned no row");
        return created;
      },
    },

    installations: {
      async list() {
        return db
          .select()
          .from(githubInstallation)
          .where(eq(githubInstallation.userId, userId))
          .orderBy(desc(githubInstallation.createdAt));
      },

      // Linking an installation twice keeps one row and refreshes the login.
      async upsert(input: { installationId: number; accountLogin: string }) {
        const [saved] = await db
          .insert(githubInstallation)
          .values({ ...input, userId })
          .onConflictDoUpdate({
            target: [
              githubInstallation.userId,
              githubInstallation.installationId,
            ],
            set: { accountLogin: input.accountLogin, updatedAt: new Date() },
          })
          .returning();
        if (!saved) throw new Error("upsert returned no row");
        return saved;
      },
    },

    projects: {
      async list() {
        return db
          .select()
          .from(project)
          .where(eq(project.userId, userId))
          .orderBy(asc(project.repoFullName));
      },

      // Returns null when the user already connected this repository.
      async create(input: {
        installationId: number;
        githubRepoId: number;
        repoFullName: string;
        defaultBranch: string;
      }) {
        const [created] = await db
          .insert(project)
          .values({ ...input, userId })
          .onConflictDoNothing({
            target: [project.userId, project.githubRepoId],
          })
          .returning();
        return created ?? null;
      },

      // Runs keep their history: their project_id becomes null.
      async remove(id: string) {
        const removed = await db
          .delete(project)
          .where(and(eq(project.id, id), eq(project.userId, userId)))
          .returning({ id: project.id });
        return removed.length > 0;
      },
    },
  };
}
