"use client";

import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Installation = {
  id: string;
  installationId: number;
  accountLogin: string;
};

type Project = {
  id: string;
  installationId: number;
  githubRepoId: number;
  repoFullName: string;
  defaultBranch: string;
};

// A repository GitHub shares with Relay (live from GitHub, not yet a project).
type SharedRepo = {
  id: number;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  installationId: number;
};

type Notice = "connected" | "error" | "unsupported";

async function getJson<T>(url: string, errorMessage: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(errorMessage);
  }
  return res.json();
}

function byName(a: Project, b: Project) {
  return a.repoFullName.localeCompare(b.repoFullName);
}

export default function RepositoriesPage() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState<SharedRepo[] | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<number | null>(null);

  useEffect(() => {
    const github = new URLSearchParams(window.location.search).get("github");
    if (
      github === "connected" ||
      github === "error" ||
      github === "unsupported"
    ) {
      setNotice(github);
      window.history.replaceState(null, "", window.location.pathname);
    }

    Promise.all([
      getJson<{ items: Installation[] }>(
        "/api/installations",
        "Could not load your GitHub connection.",
      ),
      getJson<{ items: Project[] }>(
        "/api/projects",
        "Could not load your repositories.",
      ),
    ])
      .then(([installationList, projectList]) => {
        setInstallations(installationList.items);
        setProjects(projectList.items);
      })
      .catch((error: Error) => setLoadError(error.message))
      .finally(() => setLoading(false));
  }, []);

  const installed = installations.length > 0;

  const available = (shared ?? []).filter(
    (repo) => !projects.some((project) => project.githubRepoId === repo.id),
  );

  function openDialog() {
    setOpen(true);
    setShared(null);
    setSharedError(null);
    getJson<{ items: SharedRepo[] }>(
      "/api/github/repositories",
      "Could not load repositories from GitHub.",
    )
      .then((data) => setShared(data.items))
      .catch((error: Error) => setSharedError(error.message));
  }

  async function connect(repo: SharedRepo) {
    setConnecting(repo.id);
    setSharedError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installationId: repo.installationId,
          githubRepoId: repo.id,
        }),
      });
      if (res.status === 409) {
        // Already connected (another tab): reload the list instead of failing.
        const data = await getJson<{ items: Project[] }>(
          "/api/projects",
          "Could not load your repositories.",
        );
        setProjects(data.items);
        setOpen(false);
        return;
      }
      if (!res.ok) {
        setSharedError("Could not connect that repository. Please try again.");
        return;
      }
      const created: Project = await res.json();
      setProjects((current) => [...current, created].sort(byName));
      setOpen(false);
    } catch {
      setSharedError("Could not reach the server. Please try again.");
    } finally {
      setConnecting(null);
    }
  }

  async function disconnect(project: Project) {
    setDisconnecting(project.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
      });
      // 404 means it is already gone, which is what we wanted.
      if (!res.ok && res.status !== 404) {
        setActionError("Could not disconnect that repository.");
        return;
      }
      setProjects((current) => current.filter((p) => p.id !== project.id));
    } catch {
      setActionError("Could not reach the server. Please try again.");
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Repositories</h1>
        {installed && <Button onClick={openDialog}>Add repository</Button>}
      </div>

      {notice === "connected" && <p className="text-sm">GitHub connected.</p>}
      {notice === "error" && (
        <p role="alert" className="text-sm text-destructive">
          Could not connect GitHub. Please try again.
        </p>
      )}
      {notice === "unsupported" && (
        <p role="alert" className="text-sm text-destructive">
          Only installations on your own GitHub account are supported right now.
        </p>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      )}

      {!loading && !loadError && !installed && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <GitBranch className="size-5" />
              <h2 className="font-medium">Connect your GitHub account</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Install the Relay GitHub App and choose which repositories it can
              see. You can change that choice on GitHub at any time.
            </p>
            <Button asChild>
              <a href="/api/github/connect">Connect GitHub</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {installed && (
        <>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <p className="min-w-0 truncate text-sm">
              GitHub account:{" "}
              <span className="font-medium">
                {installations.map((i) => i.accountLogin).join(", ")}
              </span>
            </p>
            <Button asChild variant="outline" size="sm">
              <a href="/api/github/connect">Change access</a>
            </Button>
          </div>

          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}

          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repositories connected yet. Use Add repository to choose one.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {projects.map((project) => (
                <li key={project.id} className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {project.repoFullName}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      Default branch: {project.defaultBranch}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disconnecting === project.id}
                    onClick={() => disconnect(project)}
                  >
                    {disconnecting === project.id
                      ? "Disconnecting..."
                      : "Disconnect"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add repository</DialogTitle>
            <DialogDescription>
              Choose from the repositories the Relay GitHub App can access. To
              share more, use Change access.
            </DialogDescription>
          </DialogHeader>

          {sharedError && (
            <p role="alert" className="text-sm text-destructive">
              {sharedError}
            </p>
          )}

          {shared === null && !sharedError && (
            <p className="text-sm text-muted-foreground">
              Loading from GitHub...
            </p>
          )}

          {shared !== null && available.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Every repository you shared with Relay is already connected.
            </p>
          )}

          {available.length > 0 && (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {available.map((repo) => (
                <li key={repo.id} className="flex items-center gap-4 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{repo.fullName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {repo.isPrivate ? "Private" : "Public"} ·{" "}
                      {repo.defaultBranch}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={connecting !== null}
                    onClick={() => connect(repo)}
                  >
                    {connecting === repo.id ? "Connecting..." : "Connect"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
