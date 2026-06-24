import type {
  ClarifyGatePayload,
  GateKind,
  GateResolution,
  InteractiveQuestion,
  RunStatus,
  SpecPlanGateEventPayload,
} from './types.js'

export type WsEventKind =
  | 'phase-start'
  | 'phase-complete'
  | 'checkpoint-start'
  | 'checkpoint-complete'
  | 'agent-start'
  | 'agent-complete'
  | 'gate-request'
  | 'gate-resolved'
  | 'status-change'
  | 'transcript-message'
  | 'interactive-question'
  | 'run-cancelled'
  | 'cost-update'

export interface WsEventBase {
  run_id: string
  t: string   // ISO timestamp
}

export interface PhaseStartEvent extends WsEventBase {
  kind: 'phase-start'
  payload: { num: number; title: string }
}

export interface PhaseCompleteEvent extends WsEventBase {
  kind: 'phase-complete'
  payload: { num: number }
}

export interface CheckpointStartEvent extends WsEventBase {
  kind: 'checkpoint-start'
  payload: { num: number; title: string }
}

export interface CheckpointCompleteEvent extends WsEventBase {
  kind: 'checkpoint-complete'
  payload: { num: number }
}

export interface AgentStartEvent extends WsEventBase {
  kind: 'agent-start'
  payload: { name: string; op: string }
}

export interface AgentCompleteEvent extends WsEventBase {
  kind: 'agent-complete'
  payload: { name: string }
}

export interface GateRequestEvent extends WsEventBase {
  kind: 'gate-request'
  payload: {
    gate_id: string
    gateKind: GateKind
    gatePayload: SpecPlanGateEventPayload | ClarifyGatePayload
  }
}

export interface GateResolvedEvent extends WsEventBase {
  kind: 'gate-resolved'
  payload: { gate_id: string; resolution: GateResolution }
}

export interface StatusChangeEvent extends WsEventBase {
  kind: 'status-change'
  payload: { status: RunStatus }
}

export interface TranscriptMessageEvent extends WsEventBase {
  kind: 'transcript-message'
  payload: { message: unknown }
}

export interface InteractiveQuestionEvent extends WsEventBase {
  kind: 'interactive-question'
  payload: { toolUseId: string; questions: InteractiveQuestion[] }
}

/**
 * Emitted by `POST /api/runs/:id/stop` when the cancel succeeds. Always
 * followed immediately by `'status-change' { status: 'cancelled' }`. The
 * `reason` field is currently only `'user'`; reserved for future
 * automated-cancel cases (e.g. budget exhaustion).
 */
export interface RunCancelledEvent extends WsEventBase {
  kind: 'run-cancelled'
  payload: { reason: 'user' }
}

export interface CostUpdateEvent extends WsEventBase {
  kind: 'cost-update'
  payload: {
    scope: 'phase' | 'total'
    phaseNum?: number
    phaseTitle?: string
    costUsd: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    apiCalls: number
    model: string
  }
}

export type WsEvent =
  | PhaseStartEvent
  | PhaseCompleteEvent
  | CheckpointStartEvent
  | CheckpointCompleteEvent
  | AgentStartEvent
  | AgentCompleteEvent
  | GateRequestEvent
  | GateResolvedEvent
  | StatusChangeEvent
  | TranscriptMessageEvent
  | InteractiveQuestionEvent
  | RunCancelledEvent
  | CostUpdateEvent
