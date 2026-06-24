import './HealthBar.css'

interface PrereqInfo {
  state: string
}

interface HealthBarProps {
  prereqs: Record<string, PrereqInfo>
}

export default function HealthBar({ prereqs }: HealthBarProps) {
  const entries = Object.values(prereqs)
  return (
    <div className="health-bar__root">
      {entries.map((p, i) => (
        <span key={i} className={`health-bar__seg health-bar__seg--${p.state}`} />
      ))}
    </div>
  )
}
