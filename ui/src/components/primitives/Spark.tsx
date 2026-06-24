import './Spark.css'

interface SparkProps {
  active?: boolean
  data?: number[]  // values 0–1, used as bar heights when provided
}

const DEFAULT_DATA = [0.4, 0.7, 0.5, 0.9, 0.6, 1, 0.5]

export default function Spark({ active, data }: SparkProps) {
  const bars = data ?? DEFAULT_DATA
  return (
    <div className="spark__root">
      {bars.map((v, i) => (
        <div
          key={i}
          className={`spark__bar${v === 0 ? ' spark__bar--muted' : ''}`}
          style={{ height: `${Math.max(8, v * 100)}%` }}
        />
      ))}
      {active && <span className="spark__dot spark__dot--active" />}
    </div>
  )
}
