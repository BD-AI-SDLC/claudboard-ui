import './Chip.css'

interface ChipProps {
  label: string
  color?: string
  className?: string
  children?: React.ReactNode
}

export default function Chip({ label, color, className, children }: ChipProps) {
  const style = color ? { borderColor: 'transparent', background: `var(--${color}-dim)`, color: `var(--${color})` } : undefined
  return (
    <span className={`chip__root${className ? ` ${className}` : ''}`} style={style}>
      {children}
      {label}
    </span>
  )
}
