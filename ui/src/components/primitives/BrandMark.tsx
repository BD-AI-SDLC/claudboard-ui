import './BrandMark.css'

interface BrandMarkProps {
  size?: number
  variant?: 'default' | 'inverted'
  className?: string
}

export default function BrandMark({ size = 20, variant = 'default', className }: BrandMarkProps) {
  const cls = ['brand-mark', variant === 'inverted' ? 'brand-mark--inverted' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={cls}
      style={{ width: size, height: size, borderRadius: `${Math.round(size * 0.24)}px` }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size}>
        <rect x="12" y="5" width="7" height="7" rx="2" className="brand-mark__cell brand-mark__cell--ghost" />
        <rect x="5" y="12" width="7" height="7" rx="2" className="brand-mark__cell" />
      </svg>
    </span>
  )
}
