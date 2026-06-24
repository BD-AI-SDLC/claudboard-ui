import type { PrereqRecord } from '@bosch-sdlc/protocol'
import { deriveMaintenanceStates } from './setup-utils.js'
import OperationCard from './OperationCard.js'

interface MaintenanceGridProps {
  prereqs: Record<string, PrereqRecord>
  running: Record<string, boolean>
  onRun: (cmd: string) => void
  onViewReport?: (cmd: string) => void
  bootstrapReady?: boolean
  runningTooltip?: string
}

export default function MaintenanceGrid({
  prereqs,
  running,
  onRun,
  onViewReport,
  bootstrapReady = true,
  runningTooltip,
}: MaintenanceGridProps) {
  const states = deriveMaintenanceStates(prereqs, running)

  return (
    <div>
      <div className="group-header">
        <h2 className="group-header__title">Maintenance</h2>
        <span className="group-header__sub">available once foundation is done — keeps artifacts fresh</span>
      </div>

      <div className="maintenance-grid">
        {states.map(item => (
          <OperationCard
            key={item.def.id}
            title={item.def.title}
            cmd={item.def.cmd}
            desc={item.def.desc}
            visualState={item.visualState}
            icon={item.def.icon}
            prereq={prereqs[item.def.id]}
            disabled={!bootstrapReady}
            runningTooltip={runningTooltip}
            onRun={() => onRun(item.def.id)}
            onViewReport={onViewReport ? () => onViewReport(item.def.id) : undefined}
          />
        ))}
      </div>
    </div>
  )
}
