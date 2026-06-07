import crypto from "node:crypto";
import { pool } from "./db";
import { enqueueSandboxRun } from "./queue";
import { compilePolicy, validateCommandAgainstPolicy } from "./policy";

export class QueueAdmissionError extends Error {
  constructor(public readonly runId: string) {
    super("queue_admission_failed");
    this.name = "QueueAdmissionError";
  }
}

export type CreateRunInput = {
  agentId: string;
  command: string;
  workspaceRef: string;
  policyYaml: string;
};

export async function createRun(input: CreateRunInput) {
  const policy = compilePolicy(input.policyYaml);
  const deniedCommands = validateCommandAgainstPolicy(input.command, policy);
  const runId = crypto.randomUUID();

  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO policies (id, digest, source_yaml, compiled_json, admission_ms)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET digest = EXCLUDED.digest,
           source_yaml = EXCLUDED.source_yaml,
           compiled_json = EXCLUDED.compiled_json,
           admission_ms = EXCLUDED.admission_ms`,
      [policy.id, policy.digest, input.policyYaml, JSON.stringify(policy.compiled), policy.admissionMs]
    );

    const status = deniedCommands.length > 0 ? "rejected" : "queued";
    await pool.query(
      `INSERT INTO runs (id, agent_id, command, workspace_ref, policy_id, status, risk_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        runId,
        input.agentId,
        input.command,
        input.workspaceRef,
        policy.id,
        status,
        JSON.stringify({ deniedCommands })
      ]
    );

    await pool.query(
      `INSERT INTO run_events (run_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [
        runId,
        status === "rejected" ? "admission.rejected" : "admission.accepted",
        JSON.stringify({ policyDigest: policy.digest, admissionMs: policy.admissionMs, deniedCommands })
      ]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  if (deniedCommands.length === 0) {
    try {
      await enqueueSandboxRun({
        runId,
        agentId: input.agentId,
        command: input.command,
        workspaceRef: input.workspaceRef,
        policyId: policy.id
      });
    } catch (error) {
      await pool.query(
        `UPDATE runs
         SET status = 'failed',
             risk_json = risk_json || $2::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [runId, JSON.stringify({ queueError: "redis_stream_enqueue_failed" })]
      );
      await pool.query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, $2, $3)`,
        [runId, "admission.enqueue_failed", JSON.stringify({ message: error instanceof Error ? error.message : "unknown" })]
      );
      throw new QueueAdmissionError(runId);
    }
  }

  return { runId, status: deniedCommands.length > 0 ? "rejected" : "queued", policy };
}

export async function getRun(runId: string) {
  const runResult = await pool.query("SELECT * FROM runs WHERE id = $1", [runId]);
  const eventsResult = await pool.query(
    "SELECT event_type, payload, created_at FROM run_events WHERE run_id = $1 ORDER BY id ASC",
    [runId]
  );

  return {
    run: runResult.rows[0] ?? null,
    events: eventsResult.rows
  };
}
