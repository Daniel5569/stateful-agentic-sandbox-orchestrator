import { describe, expect, it, beforeEach } from "vitest";
import { clearEvidenceCacheForTests, compilePolicy, validateCommandAgainstPolicy } from "./policy";

const policyYaml = `
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
    - ssh
`;

describe("policy compiler", () => {
  beforeEach(() => clearEvidenceCacheForTests());

  it("compiles YAML into deterministic constraints", () => {
    const policy = compilePolicy(policyYaml);

    expect(policy.id).toBe("test-policy");
    expect(policy.compiled.networkAllowed).toBe(false);
    expect(policy.compiled.maxSeconds).toBe(30);
    expect(policy.compiled.deniedCommandSet).toEqual(["curl", "ssh"]);
  });

  it("detects denied commands as a black-box admission rule", () => {
    const policy = compilePolicy(policyYaml);

    expect(validateCommandAgainstPolicy("python worker.py", policy)).toEqual([]);
    expect(validateCommandAgainstPolicy("curl https://example.com", policy)).toEqual(["curl"]);
  });

  it("does not reject substrings that only contain denied command names", () => {
    const policy = compilePolicy(policyYaml);

    expect(validateCommandAgainstPolicy("python secure_curl_wrapper.py", policy)).toEqual([]);
  });

  it("detects quoted and absolute-path denied commands", () => {
    const policy = compilePolicy(policyYaml);

    expect(validateCommandAgainstPolicy("'curl' https://example.com", policy)).toEqual(["curl"]);
    expect(validateCommandAgainstPolicy("/usr/bin/curl https://example.com", policy)).toEqual(["curl"]);
  });

  it("detects denied commands launched through shell wrappers", () => {
    const policy = compilePolicy(policyYaml);

    expect(validateCommandAgainstPolicy("bash -lc \"curl https://example.com\"", policy)).toEqual(["curl"]);
  });

  it("flags shell metacharacters that can hide command chaining", () => {
    const policy = compilePolicy(policyYaml);

    expect(validateCommandAgainstPolicy("python task.py; curl https://example.com", policy)).toEqual([
      "curl",
      "shell_metacharacter"
    ]);
    expect(validateCommandAgainstPolicy("python task.py $(curl https://example.com)", policy)).toEqual([
      "curl",
      "shell_metacharacter"
    ]);
    expect(validateCommandAgainstPolicy("python task.py > /tmp/out", policy)).toEqual(["shell_metacharacter"]);
  });

  it("flags common Python network and encoded payload bypasses", () => {
    const policy = compilePolicy(policyYaml);

    expect(validateCommandAgainstPolicy("python -c \"import requests; requests.get('https://e.com')\"", policy)).toEqual([
      "python_network_import"
    ]);
    expect(validateCommandAgainstPolicy("python -c \"import base64; exec(base64.b64decode('cHJpbnQoMSk='))\"", policy)).toEqual([
      "python_encoded_payload"
    ]);
  });

  it("detects nc through env/path-style launchers", () => {
    const policy = compilePolicy(policyYaml.replace("    - ssh", "    - ssh\n    - nc"));

    expect(validateCommandAgainstPolicy("PATH=/tmp:$PATH env /bin/nc 127.0.0.1 80", policy)).toEqual(["nc"]);
  });

  it("deduplicates and sorts command and path constraints", () => {
    const policy = compilePolicy(`
policy_id: sorted-policy
network:
  allow: true
filesystem:
  writable_paths:
    - /tmp
    - /workspace
    - /tmp
execution:
  max_seconds: 10
  denied_commands:
    - ssh
    - curl
    - ssh
`);

    expect(policy.compiled.writablePathSet).toEqual(["/tmp", "/workspace"]);
    expect(policy.compiled.deniedCommandSet).toEqual(["curl", "ssh"]);
  });

  it("returns a stable digest for semantically identical source input", () => {
    const first = compilePolicy(policyYaml);
    const second = compilePolicy(policyYaml);

    expect(second.digest).toBe(first.digest);
    expect(second.compiled.constraintTree).toEqual(first.compiled.constraintTree);
  });

  it("rejects policies with unsafe execution budgets", () => {
    expect(() =>
      compilePolicy(`
policy_id: unsafe-policy
network:
  allow: false
filesystem:
  writable_paths:
    - /workspace
execution:
  max_seconds: 9999
  denied_commands: []
`)
    ).toThrow();
  });

  it("rejects malformed YAML as an explicit policy validation failure", () => {
    expect(() => compilePolicy("policy_id: [")).toThrow("policy_yaml_parse_failed");
  });

  it("rejects writable paths that are not absolute", () => {
    expect(() =>
      compilePolicy(`
policy_id: bad-path-policy
network:
  allow: false
filesystem:
  writable_paths:
    - relative/path
execution:
  max_seconds: 10
  denied_commands: []
`)
    ).toThrow("policy_schema_validation_failed");
  });

  it("keeps representative admission compilation under the 100ms budget", () => {
    const policy = compilePolicy(policyYaml);

    expect(policy.admissionMs).toBeLessThan(100);
  });
});
