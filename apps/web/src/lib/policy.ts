import crypto from "node:crypto";
import yaml from "js-yaml";
import { z } from "zod";

export class PolicyValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

const PolicySchema = z.object({
  policy_id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  network: z.object({
    allow: z.boolean()
  }),
  filesystem: z.object({
    writable_paths: z.array(z.string().min(1).regex(/^\//)).default([])
  }),
  execution: z.object({
    max_seconds: z.number().int().positive().max(900),
    denied_commands: z.array(z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/)).default([])
  })
});

export type CompiledPolicy = {
  id: string;
  digest: string;
  compiled: {
    networkAllowed: boolean;
    writablePathSet: string[];
    maxSeconds: number;
    deniedCommandSet: string[];
    constraintTree: {
      all: Array<Record<string, unknown>>;
    };
  };
  admissionMs: number;
};

const evidenceCache = new Map<string, CompiledPolicy>();

export function compilePolicy(sourceYaml: string): CompiledPolicy {
  const started = performance.now();
  let loaded: unknown;
  try {
    loaded = yaml.load(sourceYaml);
  } catch (error) {
    throw new PolicyValidationError("policy_yaml_parse_failed", error);
  }

  const policyResult = PolicySchema.safeParse(loaded);
  if (!policyResult.success) {
    throw new PolicyValidationError("policy_schema_validation_failed", policyResult.error.flatten());
  }

  const parsed = policyResult.data;
  const digest = crypto.createHash("sha256").update(sourceYaml).digest("hex");
  const cached = evidenceCache.get(digest);
  if (cached) {
    return { ...cached, admissionMs: Math.max(1, Math.round(performance.now() - started)) };
  }

  const deniedCommandSet = [...new Set(parsed.execution.denied_commands)].sort();
  const writablePathSet = [...new Set(parsed.filesystem.writable_paths)].sort();
  const compiled: CompiledPolicy = {
    id: parsed.policy_id,
    digest,
    admissionMs: Math.max(1, Math.round(performance.now() - started)),
    compiled: {
      networkAllowed: parsed.network.allow,
      writablePathSet,
      maxSeconds: parsed.execution.max_seconds,
      deniedCommandSet,
      constraintTree: {
        all: [
          { network: { allow: parsed.network.allow } },
          { filesystem: { writablePaths: writablePathSet } },
          { execution: { maxSeconds: parsed.execution.max_seconds, deniedCommands: deniedCommandSet } }
        ]
      }
    }
  };

  evidenceCache.set(digest, compiled);
  return compiled;
}

export function validateCommandAgainstPolicy(command: string, policy: CompiledPolicy): string[] {
  const candidates = extractCommandCandidates(command);
  const findings = policy.compiled.deniedCommandSet.filter((denied) => candidates.has(denied.toLowerCase()));

  if (hasShellMetacharacterOutsideQuotes(command)) {
    findings.push("shell_metacharacter");
  }

  if (/\bpython(?:3)?\b[\s\S]*\b(?:import|from)\s+(?:requests|urllib|socket|http\.client)\b/i.test(command)) {
    findings.push("python_network_import");
  }

  if (/\bpython(?:3)?\b[\s\S]*(?:base64|b64decode|exec\s*\()/i.test(command)) {
    findings.push("python_encoded_payload");
  }

  return [...new Set(findings)];
}

function extractCommandCandidates(command: string): Set<string> {
  const candidates = new Set<string>();
  const roughTokens =
    command
      .replace(/["'\\]/g, " ")
      .replace(/[;&|<>(){}[\]`$]/g, " ")
      .match(/[A-Za-z0-9_./:-]+/g) ?? [];

  for (const token of roughTokens) {
    const normalized = token.toLowerCase().replace(/^env:/, "");
    const basename = normalized.split(/[\\/]/).pop() ?? normalized;
    const withoutWindowsExtension = basename.replace(/\.(?:exe|cmd|bat|ps1|sh)$/i, "");
    candidates.add(normalized);
    candidates.add(basename);
    candidates.add(withoutWindowsExtension);
  }

  return candidates;
}

function hasShellMetacharacterOutsideQuotes(command: string): boolean {
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (";&|<>`".includes(char) || (char === "$" && command[index + 1] === "(")) {
      return true;
    }
  }

  return false;
}

export function clearEvidenceCacheForTests(): void {
  evidenceCache.clear();
}
