import { NextResponse } from "next/server";
import { z } from "zod";
import { createRun, QueueAdmissionError } from "../../../lib/runs";
import { PolicyValidationError } from "../../../lib/policy";

const RunRequestSchema = z.object({
  agentId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  command: z.string().min(1).max(2000),
  workspaceRef: z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  policyYaml: z.string().min(1).max(20000)
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = RunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_run_request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await createRun(parsed.data);
    return NextResponse.json(
      {
        runId: result.runId,
        status: result.status,
        policy: {
          id: result.policy.id,
          digest: result.policy.digest,
          admissionMs: result.policy.admissionMs
        }
      },
      { status: result.status === "rejected" ? 422 : 202 }
    );
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: 400 });
    }
    if (error instanceof QueueAdmissionError) {
      return NextResponse.json({ error: "queue_admission_failed", runId: error.runId }, { status: 503 });
    }
    console.error("run_admission_unhandled_error", error);
    return NextResponse.json({ error: "run_admission_failed" }, { status: 500 });
  }
}
