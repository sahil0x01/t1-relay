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

const mockRuns: {
  id: string;
  prompt: string;
  repo: string;
  branch: string;
  status: RunStatus;
  createdAt: string;
}[] = [
  {
    id: "1",
    prompt: "Add rate limiting to the login endpoint",
    repo: "acme/web",
    branch: "main",
    status: "running",
    createdAt: "2 minutes ago",
  },
  {
    id: "2",
    prompt: "Fix the flaky checkout test",
    repo: "acme/web",
    branch: "main",
    status: "completed",
    createdAt: "1 hour ago",
  },
  {
    id: "3",
    prompt: "Upgrade Tailwind to the latest version",
    repo: "acme/docs",
    branch: "develop",
    status: "failed",
    createdAt: "yesterday",
  },
  {
    id: "4",
    prompt: "Write tests for the invoice parser",
    repo: "acme/api",
    branch: "main",
    status: "queued",
    createdAt: "yesterday",
  },
];

const statusVariant = {
  queued: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
} as const;

export default function TasksPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Tasks</h1>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            placeholder="Describe the task for the agent..."
            className="min-h-24"
            aria-label="Task"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select defaultValue="acme/web">
              <SelectTrigger className="w-40" aria-label="Repository">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="acme/web">acme/web</SelectItem>
                <SelectItem value="acme/api">acme/api</SelectItem>
                <SelectItem value="acme/docs">acme/docs</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="main">
              <SelectTrigger className="w-32" aria-label="Branch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">main</SelectItem>
                <SelectItem value="develop">develop</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="sonnet">
              <SelectTrigger className="w-48" aria-label="Model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sonnet">Claude Sonnet 5.5</SelectItem>
                <SelectItem value="opus">Claude Opus 5.5</SelectItem>
              </SelectContent>
            </Select>
            <Button className="ml-auto">Run</Button>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Recent runs
        </h2>
        <ul className="divide-y rounded-lg border">
          {mockRuns.map((run) => (
            <li key={run.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{run.prompt}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {run.repo} · {run.branch} · {run.createdAt}
                </p>
              </div>
              <Badge variant={statusVariant[run.status]}>{run.status}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
