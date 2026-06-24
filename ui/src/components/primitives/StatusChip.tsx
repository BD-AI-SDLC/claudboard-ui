import './StatusChip.css'

interface StatusChipProps {
  status: string
}

interface StatusDef {
  cls: string
  label: string
  pulse?: boolean
}

const STATUS_MAP: Record<string, StatusDef> = {
  done:     { cls: 'green',   label: 'Done'              },
  active:   { cls: 'teal',    label: 'Running', pulse: true },
  running:  { cls: 'teal',    label: 'Running', pulse: true },
  gate:     { cls: 'amber',   label: 'Awaiting approval', pulse: true },
  review:   { cls: 'violet',  label: 'In review'         },
  failed:   { cls: 'red',     label: 'Failed'            },
  merged:   { cls: 'green',   label: 'Merged'            },
  idle:     { cls: 'default', label: 'Idle'              },
  pending:  { cls: 'default', label: 'Queued'            },
  stale:    { cls: 'amber',   label: 'Stale'             },
  missing:  { cls: 'red',     label: 'Missing'           },
  'paused-gate': { cls: 'amber', label: 'Awaiting gate', pulse: true },
  'paused-user': { cls: 'default', label: 'Paused' },
  cancelled: { cls: 'slate', label: 'Cancelled' },
  dead:     { cls: 'red',     label: 'Dead'              },
}

export default function StatusChip({ status }: StatusChipProps) {
  const def = STATUS_MAP[status] ?? { cls: 'default', label: status }
  return (
    <span className={`status-chip__root status-chip--${def.cls}`}>
      <span className={`status-chip__dot${def.pulse ? ' status-chip__dot--pulse' : ''}`} />
      {def.label}
    </span>
  )
}
