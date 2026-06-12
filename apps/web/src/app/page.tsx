"use client";

import { useMemo, useState } from "react";

const defaultPolicy = `policy_id: default-terminal-sandbox
network:
  allow: false
filesystem:
  writable_paths:
    - /workspace
execution:
  max_seconds: 45
  denied_commands:
    - curl
    - wget
    - nc
    - ncat
    - ssh
    - scp`;

const baseTimeline = [
  { time: "00:00", event: "admission.accepted", detail: "Policy digest cached, run queued in Redis Stream" },
  { time: "00:02", event: "engine.started", detail: "Worker claimed message from sandbox-runs group" },
  { time: "00:04", event: "workspace.delta_applied", detail: "2 added, 1 changed, 0 deleted files hydrated" },
  { time: "00:07", event: "sandbox.finished", detail: "Command exited 0 after 812ms; stdout/stderr captured" }
];

export default function Home() {
  const [command, setCommand] = useState("python task.py");
  const [workspaceRef, setWorkspaceRef] = useState("demo-workspace");
  const [status, setStatus] = useState<"queued" | "running" | "completed" | "rejected">("completed");
  const [timeline, setTimeline] = useState(baseTimeline);

  const riskFlags = useMemo(() => {
    const flags = [];
    if (/[;&|<>`]|(?:\$\()/.test(command)) {
      flags.push("shell metacharacter");
    }
    if (/\b(?:curl|wget|nc|ncat|ssh|scp)\b/.test(command)) {
      flags.push("denied network command");
    }
    if (/python(?:3)?\b.*(?:requests|urllib|socket|base64|exec\s*\()/i.test(command)) {
      flags.push("python escape pattern");
    }
    return flags;
  }, [command]);

  function submitDemoRun() {
    const rejected = riskFlags.length > 0;
    setStatus(rejected ? "rejected" : "queued");
    setTimeline([
      {
        time: "now",
        event: rejected ? "admission.rejected" : "admission.accepted",
        detail: rejected
          ? `Blocked before enqueue: ${riskFlags.join(", ")}`
          : `Accepted ${command} for ${workspaceRef}`
      },
      ...baseTimeline.slice(rejected ? 0 : 1)
    ]);
    window.setTimeout(() => {
      if (!rejected) {
        setStatus("completed");
      }
    }, 450);
  }

  return (
    <main className="appShell">
      <section className="topbar" aria-label="Workspace summary">
        <div>
          <p className="eyebrow">Agent execution control plane</p>
          <h1>Stateful Agentic Sandbox Orchestrator</h1>
          <p className="subtitle">
            Submit long-running agent work, preview policy admission, watch queue state, and inspect the
            execution evidence a worker writes back to PostgreSQL.
          </p>
        </div>
        <button className="primaryButton" onClick={submitDemoRun} type="button">
          Submit demo run
        </button>
      </section>

      <section className="metricsGrid" aria-label="Operational metrics">
        <Metric label="Queue status" value={status} detail="Local UI state mirrors API lifecycle" />
        <Metric label="Policy latency" value="12 ms" detail="Cached SHA-256 digest path" />
        <Metric label="Pending reclaim" value="60 s" detail="XCLAIM stale-message recovery" />
        <Metric label="Dead-letter stream" value="on" detail="Invalid payloads stay inspectable" />
      </section>

      <section className="workArea">
        <form className="panel formGrid" onSubmit={(event) => event.preventDefault()}>
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Run admission</p>
              <h2>Submit sandbox work</h2>
            </div>
            <span className={`statePill ${status}`}>{status}</span>
          </div>

          <label className="field">
            <span className="fieldLabel">Workspace reference</span>
            <input value={workspaceRef} onChange={(event) => setWorkspaceRef(event.target.value)} />
          </label>

          <label className="field">
            <span className="fieldLabel">Command</span>
            <input value={command} onChange={(event) => setCommand(event.target.value)} />
          </label>

          <label className="field">
            <span className="fieldLabel">Policy YAML</span>
            <textarea readOnly value={defaultPolicy} />
          </label>

          <button className="primaryButton" onClick={submitDemoRun} type="button">
            Preview and enqueue
          </button>
        </form>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Event timeline</p>
              <h2>Run evidence</h2>
            </div>
            <span className={`statePill ${status}`}>{riskFlags.length ? `${riskFlags.length} flag(s)` : "clear"}</span>
          </div>

          <div className="timeline">
            {timeline.map((item) => (
              <article className="timelineItem" key={`${item.time}-${item.event}`}>
                <span>{item.time}</span>
                <strong>{item.event}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Operator view</p>
              <h2>Risk and output</h2>
            </div>
          </div>

          <div className="manifestGrid" aria-label="Delta manifest summary">
            <ManifestTile label="Added" value="2" />
            <ManifestTile label="Changed" value="1" />
            <ManifestTile label="Deleted" value="0" />
            <ManifestTile label="Unchanged" value="14" />
          </div>

          <pre className="codePanel">
            <small>stdout</small>
            {`\n$ ${command}\nworkspace=${workspaceRef}\nresult=completed\n`}
          </pre>

          <ul className="guardrailList">
            {(riskFlags.length ? riskFlags : ["network disabled", "write paths constrained", "worker retry visible"]).map(
              (item) => (
                <li key={item}>{item}</li>
              )
            )}
          </ul>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metricCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ManifestTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="manifestTile">
      <strong>{value}</strong>
      <span className="fieldLabel">{label}</span>
    </article>
  );
}
