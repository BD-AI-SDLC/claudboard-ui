/* eslint-disable */
/* Shared components, icons, and helpers for claudboard UI */

// ───────────────────────────────────────────── Icons (inline SVG)
const Icon = ({ name, size = 14, stroke = 1.7, className = "" }) => {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
  };
  const paths = {
    home: <path d="M3 11 12 3l9 8M5 9.5V21h14V9.5" />,
    grid: (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
    rocket: (<><path d="M5 19c0-3 2-6 5-7l9-9-1 9c-1 3-4 5-7 5l-3 3-3-1z" /><circle cx="14" cy="10" r="1.5" /></>),
    play: <path d="M7 4l13 8-13 8V4z" />,
    pulse: <path d="M3 12h4l2-6 4 12 2-6h6" />,
    book: (<><path d="M4 19V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></>),
    folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />,
    history: (<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>),
    settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
    chev: <path d="m8 9 4 4 4-4" />,
    chevR: <path d="m9 6 6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="M5 13l4 4L19 7" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    alert: (<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>),
    refresh: <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />,
    branch: (<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10M6 13c0-4 4-6 12-6" /></>),
    pr: (<><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M6 8v8M14 6h2a2 2 0 0 1 2 2v8" /></>),
    ticket: (<><path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" /><path d="M13 5v14" /></>),
    spark: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6 7.7 7.7M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />,
    clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
    pause: (<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>),
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    eye: (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>),
    edit: (<><path d="M3 17.25V21h3.75L17.8 9.9l-3.7-3.7L3 17.25z" /><path d="M14 6.5 17.5 10" /></>),
    diff: (<><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M6 9v9a3 3 0 0 0 3 3h6M18 15V6a3 3 0 0 0-3-3H9" /></>),
    code: <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />,
    cpu: (<><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" /></>),
    layers: (<><path d="m12 2 10 6-10 6L2 8l10-6z" /><path d="m2 14 10 6 10-6M2 11l10 6 10-6" /></>),
    shield: <path d="M12 2 4 5v7c0 5 4 8 8 10 4-2 8-5 8-10V5l-8-3z" />,
    bell: <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM10 21a2 2 0 0 0 4 0" />,
    user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>),
    sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>),
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
    side: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>),
    list: (<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>),
    columns: <path d="M3 4v16M9 4v16M15 4v16M21 4v16" />,
    workspace: (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
    repo: <path d="M4 4a2 2 0 0 1 2-2h11v18a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V4zM7 7h7" />,
    db:   (<><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5" /><path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" /></>),
    cloud: <path d="M7 18a5 5 0 0 1 0-10c.5-3 3-5 6-5a6 6 0 0 1 6 6h1a4 4 0 0 1 0 8z" />,
    skill: (<><path d="M12 2 4 6v6c0 5 4 9 8 10 4-1 8-5 8-10V6l-8-4z" /><path d="M9 12l2 2 4-4" /></>),
    cmd: <path d="M6 6h12v12H6zM6 9h12M6 15h12M9 6v12M15 6v12" />,
    cube: (<><path d="m12 2 9 5v10l-9 5-9-5V7l9-5z" /><path d="m12 12 9-5M12 12v10M12 12 3 7" /></>),
    flag: (<><path d="M4 21V3" /><path d="M4 4h12l-2 4 2 4H4" /></>),
    lock: (<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>),
    unlock: (<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/></>),
    download: <path d="M12 3v12M6 9l6 6 6-6M4 21h16"/>,
    arrow: <path d="M5 12h14M13 5l7 7-7 7"/>,
  };
  return <svg {...common}>{paths[name] || null}</svg>;
};

// ───────────────────────────────────────────── Status chip helpers
const StatusChip = ({ status }) => {
  const map = {
    done:     { cls: "green",  label: "Done"     },
    active:   { cls: "teal",   label: "Running", pulse: true },
    running:  { cls: "teal",   label: "Running", pulse: true },
    gate:     { cls: "amber",  label: "Awaiting approval", pulse: true },
    review:   { cls: "violet", label: "In review" },
    failed:   { cls: "red",    label: "Failed"   },
    merged:   { cls: "green",  label: "Merged"   },
    idle:     { cls: "",       label: "Idle"     },
    pending:  { cls: "",       label: "Queued"   },
    stale:    { cls: "amber",  label: "Stale"    },
    missing:  { cls: "red",    label: "Missing"  },
  };
  const s = map[status] || { cls: "", label: status };
  return (
    <span className={`chip ${s.cls}`}>
      <span className={`dot${s.pulse ? " pulse" : ""}`}></span>
      {s.label}
    </span>
  );
};

// ───────────────────────────────────────────── Health bar (5 segments)
const HealthBar = ({ states }) => (
  <div className="health-bar">
    {states.map((s, i) => <span key={i} className={`seg ${s}`}></span>)}
  </div>
);

// ───────────────────────────────────────────── Meter
const Meter = ({ value, max = 100, variant = "" }) => (
  <div className="meter">
    <div className={`fill ${variant}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }}></div>
  </div>
);

// ───────────────────────────────────────────── Sparkline (decorative)
const Spark = ({ data }) => (
  <div className="spark">
    {data.map((v, i) => (
      <div
        key={i}
        className={`b ${v === 0 ? "muted" : ""}`}
        style={{ height: `${Math.max(8, v * 100)}%` }}
      />
    ))}
  </div>
);

// ───────────────────────────────────────────── Gherkin renderer
const GherkinLine = ({ line }) => {
  if (line.kind === "blank") return <div style={{ height: "8px" }}></div>;
  if (line.kind === "feature")  return <div className="gk-feature">{line.text}</div>;
  if (line.kind === "comment")  return <div className="gk-comment">{line.text}</div>;
  if (line.kind === "scenario") return <div className="gk-scenario">{line.text}</div>;
  const kwClass = line.kind === "and" ? "gk-and" : "gk-keyword";
  return (
    <div style={{ paddingLeft: "16px" }}>
      <span className={kwClass}>{line.keyword}</span>{" "}
      {line.text}
      {line.arg && <span className="gk-string">{line.arg}</span>}
      {line.tail}
      {line.arg2 && <span className="gk-string">{line.arg2}</span>}
    </div>
  );
};

// ───────────────────────────────────────────── helpers
const cls = (...xs) => xs.filter(Boolean).join(" ");

// expose to other Babel files
Object.assign(window, {
  Icon,
  StatusChip,
  HealthBar,
  Meter,
  Spark,
  GherkinLine,
  cls,
});
