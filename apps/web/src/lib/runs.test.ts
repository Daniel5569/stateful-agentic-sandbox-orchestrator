import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  pool: {
    query: vi.fn(async () => ({ rows: [] }))
  }
}));

vi.mock("./queue", () => ({
  enqueueSandboxRun: vi.fn(async () => "stream-entry-1")
}));

import { pool } from "./db";
import { enqueueSandboxRun } from "./queue";
import { createRun, QueueAdmissionError } from "./runs";

const validPolicy = `
policy_id: test-policy
network:
  allow: false
filesystem:
  writable_paths:
    - /workspace
execution:
  max_seconds: 30
  denied_commands:
    - curl
`;

describe("run admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists accepted runs and enqueues work asynchronously", async () => {
    const result = await createRun({
      agentId: "agent-a",
      command: "python task.py",
      workspaceRef: "demo",
      policyYaml: validPolicy
    });

    expect(result.status).toBe("queued");
    expect(enqueueSandboxRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: result.runId,
        agentId: "agent-a",
        command: "python task.py",
        workspaceRef: "demo",
        policyId: "test-policy"
      })
    );
    expect(pool.query).toHaveBeenCalledWith("BEGIN");
    expect(pool.query).toHaveBeenCalledWith("COMMIT");
  });

  it("rejects denied commands before enqueueing work", async () => {
    const result = await createRun({
      agentId: "agent-a",
      command: "curl https://example.com",
      workspaceRef: "demo",
      policyYaml: validPolicy
    });

    expect(result.status).toBe("rejected");
    expect(enqueueSandboxRun).not.toHaveBeenCalled();
  });

  it("marks accepted runs as failed when Redis stream admission fails", async () => {
    vi.mocked(enqueueSandboxRun).mockRejectedValueOnce(new Error("redis down"));

    await expect(
      createRun({
        agentId: "agent-a",
        command: "python task.py",
        workspaceRef: "demo",
        policyYaml: validPolicy
      })
    ).rejects.toBeInstanceOf(QueueAdmissionError);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE runs"), expect.any(Array));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO run_events"),
      expect.arrayContaining(["admission.enqueue_failed"])
    );
  });
});
