/* eslint-disable */
/* Main app — routes between screens, hosts Tweaks */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "comfortable",
  "runLayout": "split",
  "accent": "teal",
  "workflowInstalled": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [screen, setScreen] = React.useState("run"); // start on the hero

  // apply theme + density via data attrs on root
  React.useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme;
    document.documentElement.dataset.density = tweaks.density;
    document.documentElement.dataset.runlayout = tweaks.runLayout;
    // accent
    const colors = {
      teal:   "oklch(78% 0.13 195)",
      green:  "oklch(78% 0.13 150)",
      violet: "oklch(72% 0.13 295)",
      amber:  "oklch(80% 0.13 78)",
    };
    document.documentElement.style.setProperty("--teal", colors[tweaks.accent] || colors.teal);
    document.documentElement.style.setProperty("--teal-dim", (colors[tweaks.accent] || colors.teal).replace(")", " / 0.18)"));
  }, [tweaks]);

  const goto = (s) => setScreen(s);

  let view = null;
  if (screen === "run")       view = <ScreenRun runLayout={tweaks.runLayout} goto={goto} />;
  else if (screen === "gate") view = <ScreenGate goto={goto} />;
  else if (screen === "project") view = <ScreenProject goto={goto} workflowInstalled={tweaks.workflowInstalled} />;
  else if (screen === "dashboard") view = <ScreenDashboard goto={goto} workflowInstalled={tweaks.workflowInstalled} />;
  else if (screen === "kickoff")   view = <ScreenKickoff goto={goto} />;
  else view = <PlaceholderScreen name={screen} goto={goto} />;

  return (
    <div className="app">
      <Sidebar
        screen={screen}
        setScreen={setScreen}
        project="datahandler"
        theme={tweaks.theme}
        setTheme={(t) => setTweak("theme", t)}
        workflowInstalled={tweaks.workflowInstalled}
      />
      {view}

      <TweaksPanel title="claudboard tweaks">
        <TweakSection label="State" />
        <TweakToggle
          label="feature-workflow installed"
          value={tweaks.workflowInstalled}
          onChange={(v) => {
            setTweak("workflowInstalled", v);
            // jump to Project Health when locking, so the lock surfaces
            if (!v) setScreen("project");
          }}
        />

        <TweakSection label="Theme" />
        <TweakRadio
          label="Mode"
          value={tweaks.theme}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          onChange={(v) => setTweak("theme", v)}
        />
        <TweakRadio
          label="Accent"
          value={tweaks.accent}
          options={[
            { value: "teal",   label: "Teal" },
            { value: "green",  label: "Green" },
            { value: "violet", label: "Violet" },
          ]}
          onChange={(v) => setTweak("accent", v)}
        />

        <TweakSection label="Layout" />
        <TweakRadio
          label="Density"
          value={tweaks.density}
          options={[
            { value: "comfortable", label: "Comfy" },
            { value: "compact",     label: "Compact" },
            { value: "tight",       label: "Tight" },
          ]}
          onChange={(v) => setTweak("density", v)}
        />
        <TweakSelect
          label="Run view"
          value={tweaks.runLayout}
          options={[
            { value: "split",    label: "3‑pane (tree · stream · rail)" },
            { value: "timeline", label: "2‑pane (stream · rail)" },
            { value: "log",      label: "Log only — terminal mode" },
          ]}
          onChange={(v) => setTweak("runLayout", v)}
        />

        <TweakSection label="Jump to screen" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" }}>
          {[
            ["dashboard","Overview"],
            ["project","Project"],
            ["kickoff","Kickoff"],
            ["run","Active run"],
            ["gate","Review gate"],
          ].map(([id,label]) => (
            <button
              key={id}
              className="twk-field"
              style={{
                cursor: "pointer",
                background: screen === id ? "rgba(0,0,0,.06)" : undefined,
                fontWeight: screen === id ? 600 : 400,
                textAlign: "left",
                padding: "0 10px",
              }}
              onClick={() => setScreen(id)}
            >{label}</button>
          ))}
        </div>
      </TweaksPanel>
    </div>
  );
}

function PlaceholderScreen({ name, goto }) {
  const titles = {
    history:  "Run history",
    skills:   "Skills",
    rules:    "Rules",
    settings: "Settings",
  };
  return (
    <div className="main">
      <div className="topbar">
        <div className="crumb">
          <Icon name="workspace" size={14} />
          <span>meas</span>
          <span className="sep">/</span>
          <span className="now">{titles[name] || name}</span>
        </div>
      </div>
      <div className="page">
        <h1>{titles[name] || name}</h1>
        <div className="sub">Surface stub. The connected demo focuses on Overview · Project · Kickoff · Active run · Review gate.</div>
        <div style={{ marginTop: "20px", display: "flex", gap: "8px" }}>
          <button className="btn primary" onClick={() => goto("run")}>Go to active run</button>
          <button className="btn" onClick={() => goto("dashboard")}>Back to overview</button>
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
