/* eslint-disable */
/* Mock data for the Phase 1a interview / clarification turn */

window.INTERVIEW = {
  context: {
    phase: "Phase 1a",
    phaseLabel: "Clarify scope",
    agent: "main",
    ticket: "MEAS-7140",
    title: "Outbox dispatcher for entitlement events",
    elapsed: "3m 12s",
    elapsedTotal: "6m 41s",
    asked: 3,
    total: 6,
    estReply: "~4 min",
  },

  // The questions the orchestrator wants answered before handing off to sdd-expert
  questions: [
    {
      id: "q1",
      group: "Topology",
      text: "Should outbox events be published to a single topic or to per‑event‑type topics?",
      why: "Affects partition key strategy and consumer fan‑out. `.claude/rules/kafka-producer.md` defaults to per‑aggregate topics — confirm this applies here.",
      options: [
        { id: "single",  label: "Single topic", sub: "entitlement.events.v1" },
        { id: "perType", label: "Per type", sub: "entitlement.granted.v1, entitlement.revoked.v1" },
      ],
      answer: "single",
      answerNote: "Keep it simple — one topic, partition by tenantId.",
      status: "answered",
    },
    {
      id: "q2",
      group: "Semantics",
      text: "What delivery guarantee do downstream consumers need?",
      why: "Exactly‑once requires idempotency keys on consumers and adds an extra checkpoint in the architect's plan.",
      options: [
        { id: "atLeast", label: "At‑least‑once", sub: "Cheaper. Consumers must be idempotent." },
        { id: "exactly", label: "Exactly‑once", sub: "Adds transactional outbox + dedup table." },
      ],
      answer: "atLeast",
      answerNote: "",
      status: "answered",
    },
    {
      id: "q3",
      group: "Storage",
      text: "Where should the outbox table live?",
      why: "Two patterns detected in this repo: per‑tenant (most aggregates) vs central infra DB (audit log). Architect needs a decision.",
      options: [
        { id: "tenant",  label: "Per‑tenant DB", sub: "Matches OutboxEvent siblings (OrderEvent, EntitlementEvent)" },
        { id: "central", label: "Central infra DB", sub: "Matches audit_log_events" },
      ],
      answer: "tenant",
      answerNote: "",
      status: "answered",
    },
    {
      id: "q4",
      group: "Failure modes",
      text: "On broker outage, how should the dispatcher retry?",
      why: "Mongoose existing retry config uses fixed 30s intervals. Backoff would diverge from the platform default.",
      options: [
        { id: "fixed",   label: "Fixed 30s tick", sub: "Default. Matches platform retry policy." },
        { id: "backoff", label: "Exponential 5s → 5m", sub: "Reduces load on unhealthy brokers. New pattern." },
        { id: "halt",    label: "Halt + alert", sub: "No automatic retry. Ops handles it." },
      ],
      answer: null,
      answerNote: "",
      status: "current",
    },
    {
      id: "q5",
      group: "Lifecycle",
      text: "After successful dispatch, should events be purged or archived?",
      why: "Affects DB growth. No project rule covers this — orchestrator wants to confirm before sdd-expert writes the spec.",
      options: [
        { id: "purge30",  label: "Purge after 30d" },
        { id: "purge7",   label: "Purge after 7d" },
        { id: "archive",  label: "Move to archive collection" },
        { id: "keep",     label: "Keep forever" },
      ],
      answer: null,
      answerNote: "",
      status: "pending",
    },
    {
      id: "q6",
      group: "Out of scope",
      text: "Anything explicitly out of scope I should note in the spec?",
      why: "Will be added as a 'Non‑goals' section. Common omissions: schema registry, multi‑region replication, observability dashboards.",
      options: [
        { id: "schemaReg", label: "Schema registry" },
        { id: "multiReg",  label: "Multi‑region replication" },
        { id: "obs",       label: "Dashboards / alerting" },
        { id: "consumers", label: "Downstream consumers" },
      ],
      multi: true,
      answer: null,
      answerNote: "",
      status: "pending",
    },
  ],

  // Where else the interview shows up in the workflow
  otherMoments: [
    { phase: "Pre‑Phase 1", agent: "main", trigger: "Initial scope ambiguous", example: "“Is this a bug or a new feature?”" },
    { phase: "Phase 1b",    agent: "sdd-expert",    trigger: "Acceptance criteria ambiguous", example: "“What's the exact error state in scenario 3?”" },
    { phase: "Phase 1c",    agent: "architect",     trigger: "Architectural fork", example: "“Use OutboxEvent or extend DomainEvent?”" },
    { phase: "Phase 3",     agent: "implementation",trigger: "Plan didn't account for X", example: "“Tests need a new fixture — proceed how?”" },
    { phase: "Phase 5",     agent: "design-reviewer", trigger: "Finding needs your call", example: "“Reviewer wants stricter validation — apply or defer?”" },
  ],
};
