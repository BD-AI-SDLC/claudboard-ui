import type { PrereqRecord } from '@bosch-sdlc/protocol'
import { deriveFoundationStates, foundationDone } from './setup-utils.js'
import OperationCard from './OperationCard.js'

interface FoundationChainProps {
  prereqs: Record<string, PrereqRecord>
  running: Record<string, boolean>
  onRun: (cmd: string) => void
  onViewReport?: (cmd: string) => void
  bootstrapReady?: boolean
  runningTooltip?: string
}

export default function FoundationChain({ prereqs, running, onRun, onViewReport, bootstrapReady = true, runningTooltip }: FoundationChainProps) {
  const states = deriveFoundationStates(prereqs, running)
  const doneCount = states.filter(s => s.visualState === 'done' || s.visualState === 'done-imported').length
  const allDone = foundationDone(prereqs)

  return (
    <div>
      <div className="group-header">
        <h2 className="group-header__title">Foundation</h2>
        <span className="group-header__sub">ordered — each step requires the previous</span>
        <span className="group-header__badge">{doneCount} / 3</span>
      </div>

      <div className="foundation-chain">
        {states.map((item, i) => (
          <>
            {i > 0 && <div className="foundation-chain__link" key={`arrow-${i}`}>→</div>}
            <OperationCard
              key={item.def.id}
              title={item.def.title}
              cmd={item.def.cmd}
              desc={item.def.desc}
              visualState={item.visualState}
              stepNumber={item.def.step}
              prereq={prereqs[item.def.id]}
              disabled={!bootstrapReady}
              locked={allDone}
              runningTooltip={runningTooltip}
              onRun={() => onRun(item.def.id)}
              onViewReport={onViewReport ? () => onViewReport(item.def.id) : undefined}
            />
          </>
        ))}
      </div>
    </div>
  )
}
