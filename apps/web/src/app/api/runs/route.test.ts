import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/runs", () => {
  class QueueAdmissionError extends Error {
    constructor(public readonly runId: string) {
      super("queue_admission_failed");
    }
  }

  return {
    createRun: vi.fn(),
    QueueAdmissionError
  };
});

import { createRun, QueueAdmissionError } from "../../../lib/runs";
import { POST } from "./route";

const validBody = {
  agentId: "agent-a",
  command: "python task.py",
  workspaceRef: "demo",
  policyYaml: `
policy_id: test-policy
network:
  allow: false
filesystem:
  writable_paths:
    - /workspace
execution:
  max_seconds: 30
  denied_commands: []
`
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost:3000/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for malformed run requests", async () => {
    const response = await POST(jsonRequest({ command: "python task.py" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_run_request" });
  });

  it("returns 400 for invalid JSON bodies", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_json" });
  });

  it("returns 202 when admission accepts the run", async () => {
    vi.mocked(createRun).mockResolvedValueOnce({
      runId: "run-1",
      status: "queued",
      policy: { id: "test-policy", digest: "digest", admissionMs: 2, compiled: {} as never }
    });

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ runId: "run-1", status: "queued" });
  });

  it("returns 422 when policy admission rejects the command", async () => {
    vi.mocked(createRun).mockResolvedValueOnce({
      runId: "run-2",
      status: "rejected",
      policy: { id: "test-policy", digest: "digest", admissionMs: 2, compiled: {} as never }
    });

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ runId: "run-2", status: "rejected" });
  });

  it("returns 503 when queue admission fails after persistence", async () => {
    vi.mocked(createRun).mockRejectedValueOnce(new QueueAdmissionError("run-3"));

    const response = await POST(jsonRequest(validBody));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "queue_admission_failed", runId: "run-3" });
  });
});
