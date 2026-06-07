import { NextResponse } from "next/server";
import { getRun } from "../../../../lib/runs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const result = await getRun(params.id);
  if (!result.run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
