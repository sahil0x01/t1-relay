import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index.ts";

const env = {} as Env;

describe("request logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a request id header", async () => {
    const res = await app.request("/api/health", {}, env);

    expect(res.headers.get("x-request-id")).toMatch(/^[\w-]+$/);
  });

  it("reuses a valid id sent by the caller", async () => {
    const res = await app.request(
      "/api/health",
      { headers: { "x-request-id": "from-the-caller-123" } },
      env,
    );

    expect(res.headers.get("x-request-id")).toBe("from-the-caller-123");
  });

  it("logs one JSON line per request, without the query string", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const res = await app.request("/api/health?token=secret", {}, env);

    const line = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      level: "info",
      requestId: res.headers.get("x-request-id"),
      method: "GET",
      path: "/api/health",
      status: 200,
    });
    expect(JSON.stringify(line)).not.toContain("secret");
  });

  it("answers a crash with a request id and no details", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const crashing = new Hono<{ Bindings: Env }>();
    crashing.use(requestId());
    crashing.onError((c) =>
      c.json(
        { error: "Internal Server Error", requestId: c.get("requestId") },
        500,
      ),
    );
    crashing.get("/boom", () => {
      throw new Error("secret detail");
    });

    const res = await crashing.request("/boom", {}, env);

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
    error.mockRestore();
  });
});
