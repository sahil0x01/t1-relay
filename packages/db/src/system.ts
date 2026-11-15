import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./index.ts";
import { githubInstallation, project } from "./schema.ts";

// Queries that are deliberately NOT scoped to one user. They exist for events
// that arrive from outside (webhooks) and affect everyone who linked the same
// GitHub installation. Only callers that have already verified the event
// (for example a checked webhook signature) may use them.

// Removes the installation for every user. Their projects go with it, through
// the composite foreign key.
export async function removeInstallation(db: Db, installationId: number) {
  await db
    .delete(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId));
}

export async function removeProjectsForRepos(
  db: Db,
  installationId: number,
  githubRepoIds: number[],
) {
  if (githubRepoIds.length === 0) return;
  await db
    .delete(project)
    .where(
      and(
        eq(project.installationId, installationId),
        inArray(project.githubRepoId, githubRepoIds),
      ),
    );
}
