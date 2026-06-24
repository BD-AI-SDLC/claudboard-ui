/* eslint-disable */
/* Active run screen — split view: phases/agents | live stream | telemetry rail */

const ScreenRun = ({ runLayout, goto }) => {
  const D = window.DATA;
  const run = D.run;
  const [sel, setSel] = React.useState("architect");
  const streamRef = React.useRef(null);

  React.useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, []);

  return (
    <div className="main">
      {/* topbar */}
      <div className="topbar">
        <div className="crumb">
          <Icon name="repo" size={14} />
          <span>{run.repo}</span>
          <span className="sep">/</span>
          <span>runs</span>
          <span className="sep">/</span>
          <span className="now mono">{run.ticket}</span>
        </div>
        <div className="spacer"></div>
        <span className="chip mono">
          <Icon name="branch" size={11} />
          {run.branch}
        </span>
        <span className="key">⌘ K</span>
      </div>

      {/* banner */}
      <div className="run-banner">
        <div className="rb-ico"><Icon name="pause" size={16} /></div>
        <div>
          <div className="rb-t">Paused at Phase 1d · awaiting your approval of spec + plan</div>
          <div className="rb-s">After approval, the workflow runs autonomously through phases 2–7. Last edit 4m ago by architect-agent.</div>
        </div>
        <div className="actions">
          <button className="btn ghost"><Icon name="eye" size={12} />Diff</button>
          <button className="btn"><Icon name="edit" size={12} />Request changes</button>
          <button className="btn amber" onClick={() => goto("gate")}>
            <Icon name="flag" size={12} />Review spec + plan
          </button>
        </div>
      </div>

      {/* split */}
      <div className="split">
        {/* left: pipeline */}
        {runLayout !== "log" && (
          <div className="pane">
            <div className="pane-head">
              <h4>Pipeline</h4>
              <span className="sub">7 phases · 8 agents · {run.elapsed}</span>
            </div>
            <div className="pane-body">
              {run.phases.map(ph => {
                const status = ph.status;
                return (
                  <div key={ph.id} className="phase" data-status={status}>
                    <div className="phase-head">
                      <span className="num">{ph.num}</span>
                      <span className="title">{ph.title}</span>
                      <span className="dur">{ph.elapsed}</span>
                    </div>
                    <div className="agents">
                      {ph.agents.map(a => (
                        <div
                          key={a.id}
                          className={cls("agent", sel === a.id && "sel")}
                          data-status={a.status}
                          onClick={() => setSel(a.id)}
                        >
                          <span className="ico">{agentMark(a.name)}</span>
                          <span className="name">
                            <b>{a.name}</b> <em>· {a.op}</em>
                          </span>
                          {a.status === "active" && <span className="pulse-dot"></span>}
                          <span className="dur">{a.dur}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* middle: stream */}
        <div className="pane">
          <div className="pane-head">
            <h4>Live stream</h4>
            <span className="sub">{run.stream.length} events</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
              <span className="chip"><Icon name="check" size={10} />main</span>
              <span className="chip"><Icon name="user" size={10} />all agents</span>
              <button className="btn ghost sm"><Icon name="pause" size={11} />Pause</button>
            </div>
          </div>
          <div className="stream" ref={streamRef}>
            {run.stream.map((ev, i) => (
              <div key={i} className={`ev ${ev.cls || ""}`}>
                <span className="t">{ev.t}</span>
                <span className="ag">{ev.ag}</span>
                <span className="msg">{ev.msg}</span>
              </div>
            ))}
            <div className="sep">waiting for human gate</div>
            <div className="ev gate">
              <span className="t">—</span>
              <span className="ag">user</span>
              <span className="msg">
                <span className="pulse-dot" style={{ display: "inline-block", marginRight: "6px", verticalAlign: "middle" }}></span>
                review spec + plan to continue
              </span>
            </div>
          </div>
        </div>

        {/* right: rail */}
        {runLayout === "split" && (
          <div className="pane" style={{ background: "var(--bg-2)" }}>
            <div className="pane-head">
              <h4>Run telemetry</h4>
            </div>
            <div className="pane-body" style={{ padding: 0 }}>
              <div className="rail-section">
                <div className="rail-h">Ticket</div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <span className="chip mono violet" style={{ padding: "3px 8px" }}><Icon name="ticket" size={11} />{run.ticket}</span>
                  <span className="chip">Story</span>
                </div>
                <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>{run.title}</div>
              </div>

              <div className="rail-section">
                <div className="rail-h">Status</div>
                <div style={{ marginBottom: "10px" }}><StatusChip status="gate" /></div>
                <Meter value={28} variant="amber" />
                <div className="kv"><span className="k">Phase</span><span className="v">1 / 7</span></div>
                <div className="kv"><span className="k">Checkpoint</span><span className="v">0 / 4</span></div>
                <div className="kv"><span className="k">Elapsed</span><span className="v mono">{run.elapsed}</span></div>
                <div className="kv"><span className="k">Started</span><span className="v mono">{run.started}</span></div>
              </div>

              <div className="rail-section">
                <div className="rail-h">Cost · tokens</div>
                <div className="kv"><span className="k">Cost</span><span className="v mono">${run.cost.toFixed(2)}</span></div>
                <div className="kv"><span className="k">In</span><span className="v mono">{run.tokensIn.toLocaleString()}</span></div>
                <div className="kv"><span className="k">Out</span><span className="v mono">{run.tokensOut.toLocaleString()}</span></div>
                <Spark data={[.2,.3,.5,.4,.6,.8,.7,.9,.6,.4,.5,.3,.2,0,0,0]} />
                <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "4px" }}>token spend per minute</div>
              </div>

              <div className="rail-section">
                <div className="rail-h">Context loaded</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)", lineHeight: 1.7, color: "var(--text-2)" }}>
                  <div>CLAUDE.md <span style={{ color: "var(--muted)" }}>· 112 lines</span></div>
                  <div>.claude/rules/ <span style={{ color: "var(--muted)" }}>· 7 files · 412 lines</span></div>
                  <div>.claude/skills/ <span style={{ color: "var(--muted)" }}>· 4 skills</span></div>
                  <div style={{ color: "var(--muted)" }}>.claude/memories/ <span style={{ color: "var(--dim)" }}>· empty</span></div>
                </div>
              </div>

              <div className="rail-section">
                <div className="rail-h">Capability flags</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  {["JIRA_AVAILABLE","ADO_AVAILABLE","MONGODB","KAFKA","JPA","SAGA","OUTBOX"].map(f => (
                    <span key={f} className="chip mono" style={{ padding: "2px 7px", fontSize: "10px" }}>{f}</span>
                  ))}
                  {["CIRCUIT_BREAKER","GRAPHQL","WEBSOCKET"].map(f => (
                    <span key={f} className="chip mono" style={{ padding: "2px 7px", fontSize: "10px", color: "var(--dim)", opacity: 0.7 }}>{f}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function agentMark(name) {
  const m = {
    "main":           "•",
    "jira-agent":     "J",
    "sdd-expert":     "S",
    "architect":      "A",
    "implementation": "I",
    "spec-reviewer":  "R",
    "design-reviewer":"D",
    "git-agent":      "G",
    "pr-agent":       "P",
    "user":           "U",
  };
  return m[name] || "?";
}

window.ScreenRun = ScreenRun;
