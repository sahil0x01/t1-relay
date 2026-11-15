"use client";

import { type SubmitEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  prompt: string;
  repo: string;
  branch: string;
  model: string;
  status: RunStatus;
  createdAt: string;
};

type RunPage = { items: Run[]; nextCursor: string | null };

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

  const [prompt, setPrompt] = useState("");
  const [repo, setRepo] = useState("acme/web");
  const [branch, setBranch] = useState("main");
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
        body: JSON.stringify({ prompt, repo, branch, model }),
      });
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
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select value={repo} onValueChange={setRepo}>
                <SelectTrigger className="w-40" aria-label="Repository">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acme/web">acme/web</SelectItem>
                  <SelectItem value="acme/api">acme/api</SelectItem>
                  <SelectItem value="acme/docs">acme/docs</SelectItem>
                </SelectContent>
              </Select>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="w-32" aria-label="Branch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">main</SelectItem>
                  <SelectItem value="develop">develop</SelectItem>
                </SelectContent>
              </Select>
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
                disabled={submitting || prompt.trim() === ""}
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
