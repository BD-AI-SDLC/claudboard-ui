/* eslint-disable */
/* Spec + Plan approval gate */

const ScreenGate = ({ goto }) => {
  const D = window.DATA;
  const g = D.gate;

  return (
    <div className="main">
      <div className="topbar">
        <div className="crumb">
          <Icon name="repo" size={14} />
          <span>meas.cloud.datahandler</span>
          <span className="sep">/</span>
          <span className="now mono">{g.ticket}</span>
          <span className="sep">/</span>
          <span>review</span>
        </div>
        <div className="spacer"></div>
        <span className="chip amber"><span className="dot pulse"></span>Phase 1d · human gate</span>
      </div>

      <div className="gate-head">
        <div className="gico"><Icon name="flag" size={18} /></div>
        <div style={{ flex: 1 }}>
          <div className="gt">Approve to enter autonomous mode</div>
          <div className="gs">After approval, phases 2–7 (branch · develop · commit · review · PR · finalize) run unattended for an estimated <b>3h 24m</b>. This is the only human checkpoint.</div>
        </div>
        <div className="actions">
          <button className="btn ghost"><Icon name="diff" size={12} />Compare to last run</button>
          <button className="btn danger"><Icon name="x" size={12} />Reject</button>
          <button className="btn"><Icon name="edit" size={12} />Request changes</button>
          <button className="btn amber"><Icon name="check" size={12} />Approve · start autonomy</button>
        </div>
      </div>

      <div className="gate-split">
        {/* spec */}
        <div className="gate-col">
          <div className="gate-col-head">
            <Icon name="cube" size={13} />
            <div>
              <div className="gt">BDD specification</div>
              <div className="sub">by sdd-expert-agent · 3 scenarios · 14 steps · src/test/.../outbox-dispatcher.feature</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
              <span className="chip mono">.feature</span>
              <button className="btn ghost sm"><Icon name="code" size={11} />Raw</button>
            </div>
          </div>
          <div className="gate-col-body">
            {g.spec.map((line, i) => <GherkinLine key={i} line={line} />)}
          </div>
        </div>

        {/* plan */}
        <div className="gate-col">
          <div className="gate-col-head">
            <Icon name="layers" size={13} />
            <div>
              <div className="gt">Execution plan</div>
              <div className="sub">by architect-agent · 4 checkpoints · 11 tasks · 7 contracts · est. 3h 24m</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
              <span className="chip mono">plan.md</span>
              <button className="btn ghost sm"><Icon name="code" size={11} />Raw</button>
            </div>
          </div>
          <div className="gate-col-body" style={{ fontFamily: "var(--font-sans)" }}>
            <div style={{ marginBottom: "14px", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--bg)" }}>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600, marginBottom: "8px" }}>Approach</div>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", lineHeight: 1.6 }}>
                Transactional outbox with a scheduled dispatcher. Reuses existing <code className="mono" style={{ color: "var(--teal)" }}>KafkaTemplate</code> wiring and the Mongo reactive driver already configured in <code className="mono" style={{ color: "var(--teal)" }}>persistence/MongoConfig</code>. No infrastructure changes — outbox lives in the existing tenant database.
              </div>
            </div>

            {g.plan.map(cp => (
              <div key={cp.num} className="cp">
                <div className="cp-h">
                  <span className="cp-num">{cp.num}</span>
                  <span>{cp.title}</span>
                </div>
                <div className="cp-desc">{cp.desc}</div>
                <div className="cp-tags">
                  {cp.files.map(f => (
                    <span key={f} className="chip mono"><Icon name="code" size={10} />{f}</span>
                  ))}
                  {cp.contracts.map(c => (
                    <span key={c} className="chip violet">{c}</span>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ marginTop: "18px", padding: "12px 14px", border: "1px dashed var(--amber)", borderRadius: "var(--radius)", background: "var(--amber-dim)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "var(--fs-sm)", color: "var(--amber)", marginBottom: "4px" }}>
                <Icon name="alert" size={12} />Review notes
              </div>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", lineHeight: 1.6 }}>
                Plan touches <b>3 layers</b>: domain, application, adapter. Consistent with the project's hexagonal convention from <code className="mono" style={{ color: "var(--text)" }}>.claude/rules/architecture.md</code>. The architect skipped a schema-registry checkpoint because the repo doesn't use Avro — confirm this is intentional.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.ScreenGate = ScreenGate;
