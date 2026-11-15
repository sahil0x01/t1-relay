"use client";

import Link from "next/link";
import { type SubmitEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type RunStatus = "queued" | "running" | "completed" | "failed";

type Run = {
  id: string;
  projectId: string | null;
  prompt: string;
  repo: string;
  branch: string;
  model: string;
  status: RunStatus;
  createdAt: string;
};

type RunPage = { items: Run[]; nextCursor: string | null };

type Project = { id: string; repoFullName: string; defaultBranch: string };

const statusVariant = {
  queued: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
} as const;

async function fetchRuns(cursor?: string): Promise<RunPage> {
  const query = cursor ? `?cursor=${cursor}` : "";
  const res = await fetch(`/api/runs${query}`);
  if (!res.ok) {
    throw new Error("Could not load runs.");
  }
  return res.json();
}

export default function TasksPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [branch, setBranch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("sonnet");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns()
      .then((page) => {
        setRuns(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((error: Error) => setLoadError(error.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Could not load your repositories.");
        }
        return res.json() as Promise<{ items: Project[] }>;
      })
      .then((data) => {
        setProjects(data.items);
        const first = data.items[0];
        if (first) {
          setProjectId(first.id);
          setBranch(first.defaultBranch);
        }
      })
      .catch((error: Error) => setLoadError(error.message))
      .finally(() => setProjectsLoaded(true));
  }, []);

  const noProjects = projectsLoaded && projects.length === 0;

  function chooseProject(id: string) {
    setProjectId(id);
    const project = projects.find((p) => p.id === id);
    if (project) {
      setBranch(project.defaultBranch);
    }
  }

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchRuns(nextCursor);
      setRuns((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, branch, prompt, model }),
      });
      if (res.status === 404) {
        setSubmitError(
          "That repository is no longer connected. Choose another one.",
        );
        return;
      }
      if (!res.ok) {
        setSubmitError("Could not create the run. Please try again.");
        return;
      }
      const created: Run = await res.json();
      setRuns((current) => [created, ...current]);
      setPrompt("");
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Tasks</h1>

      <Card>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the task for the agent..."
              className="min-h-24"
              aria-label="Task"
              maxLength={10000}
              disabled={noProjects}
            />
            {noProjects && (
              <p className="text-sm text-muted-foreground">
                Connect a repository on the{" "}
                <Link
                  href="/dashboard/repositories"
                  className="font-medium underline"
                >
                  Repositories
                </Link>{" "}
                page before you start a task.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={projectId}
                onValueChange={chooseProject}
                disabled={noProjects}
              >
                <SelectTrigger className="w-52" aria-label="Repository">
                  <SelectValue placeholder="Repository" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.repoFullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="Branch"
                aria-label="Branch"
                className="w-36"
                maxLength={255}
                disabled={noProjects}
              />
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-48" aria-label="Model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sonnet">Claude Sonnet 5.5</SelectItem>
                  <SelectItem value="opus">Claude Opus 5.5</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="submit"
                className="ml-auto"
                disabled={
                  submitting ||
                  noProjects ||
                  projectId === "" ||
                  branch.trim() === "" ||
                  prompt.trim() === ""
                }
              >
                {submitting ? "Starting..." : "Run"}
              </Button>
            </div>
            {submitError && (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Recent runs
        </h2>

        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}

        {!loading && !loadError && runs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No runs yet. Describe a task above and press Run.
          </p>
        )}

        {runs.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{run.prompt}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {run.repo} · {run.branch} ·{" "}
                    {new Date(run.createdAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <Badge variant={statusVariant[run.status]}>{run.status}</Badge>
              </li>
            ))}
          </ul>
        )}

        {nextCursor && (
          <Button
            variant="outline"
            className="w-fit"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        )}
      </section>
    </div>
  );
}
