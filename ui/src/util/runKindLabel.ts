import type { RunKind } from '@bosch-sdlc/protocol'

const KIND_LABELS: Record<string, string> = {
  'feature':              'Feature workflow',
  'prereq':               'Prerequisite setup',
  'claudboard-analyse':   'Claudboard analyse',
  'claudboard-generate':  'Claudboard generate',
  'claudboard-workflow':  'Claudboard workflow',
  'claudboard-refresh':   'Claudboard refresh',
  'claudboard-techdebt':  'Claudboard techdebt',
}

export function runKindLabel(kind: RunKind | undefined): string {
  if (kind == null) return 'Run in progress'
  return KIND_LABELS[kind as string] ?? 'Run in progress'
}
