export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 980, margin: "48px auto", padding: 24 }}>
      <h1>Stateful Agentic Sandbox Orchestrator</h1>
      <p>
        Asynchronous Node.js + Python control plane for long-running agent execution, policy evidence
        caching, and delta-hydrated sandbox workspaces.
      </p>
      <section>
        <h2>Control Plane</h2>
        <ul>
          <li>POST /api/runs accepts work without blocking on execution.</li>
          <li>GET /api/runs/:id returns persisted job state and audit events.</li>
          <li>Python workers consume Redis jobs and write execution evidence.</li>
        </ul>
      </section>
    </main>
  );
}

