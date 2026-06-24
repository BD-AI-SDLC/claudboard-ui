import './Meter.css'

interface MeterProps {
  value: number   // 0–1
  color?: string  // 'green' | 'amber' | 'red' | 'violet' | undefined (teal default)
}

export default function Meter({ value, color }: MeterProps) {
  const pct = Math.min(1, Math.max(0, value)) * 100
  return (
    <div className="meter__bar">
      <div
        className={`meter__fill${color ? ` meter__fill--${color}` : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
