import type { WsEvent } from '@bosch-sdlc/protocol'

export type HeaderEntry = { kind: 'header'; model: string; tools: number; time?: string }
export type TextEntry = { kind: 'text'; agent: string; depth: number; text: string; time?: string }
export type ThinkingEntry = { kind: 'thinking'; agent: string; depth: number; text: string; time?: string }
export type ToolEntry = {
  kind: 'tool'
  agent: string
  depth: number
  toolName: string
  argSummary: string
  resultPreview?: string
  isError?: boolean
  time?: string
}
export type FooterEntry = { kind: 'footer'; durationMs: number; costUsd: number; time?: string }

export type StreamEntry = HeaderEntry | TextEntry | ThinkingEntry | ToolEntry | FooterEntry

type ContentBlock = {
  type?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  text?: string
  thinking?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

type SdkMessage = {
  type?: string
  parent_tool_use_id?: string | null
  model?: string
  tools?: unknown[]
  duration_ms?: number
  total_cost_usd?: number
  message?: { content?: ContentBlock[] }
}

export function summarizeArgs(name: string, input: Record<string, unknown>): string {
  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
  if (name === 'Bash') return trunc(String(input.command ?? '').split('\n')[0] ?? '', 60)
  if (name === 'Read' || name === 'Write' || name === 'Edit') return String(input.file_path ?? '')
  if (name === 'Grep' || name === 'Glob') return String(input.pattern ?? '')
  if (name === 'Task') return String(input.subagent_type ?? input.description ?? '')
  const firstKey = Object.keys(input)[0]
  if (!firstKey) return ''
  return trunc(`${firstKey}=${String(input[firstKey])}`, 60)
}

export function previewResult(toolName: string, content: unknown): string {
  let text: string
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = (content as Array<{ text?: string }>).map((b) => b.text ?? '').join('\n')
  } else {
    text = JSON.stringify(content)
  }

  if (toolName === 'Read') {
    return `${text.split('\n').length} lines`
  }

  const lines = text.split('\n')
  const preview = lines.slice(0, 3).map((l) => (l.length > 200 ? l.slice(0, 200) + '…' : l))
  const truncated = lines.length > 3 || lines.some((l) => l.length > 200)
  return preview.join('\n') + (truncated ? ' …' : '')
}

export function buildStream(events: WsEvent[]): StreamEntry[] {
  const entries: StreamEntry[] = []
  const toolById = new Map<string, ToolEntry>()
  const agentByTask = new Map<string, string>()
  let headerEmitted = false

  for (const ev of events) {
    if (ev.kind !== 'transcript-message') continue
    const msg = ev.payload.message as SdkMessage
    if (!msg?.type) continue

    const t = ev.t
    const parentId = msg.parent_tool_use_id ?? null
    const depth = parentId ? 1 : 0
    const agent = parentId ? (agentByTask.get(parentId) ?? 'sub') : 'main'

    if (msg.type === 'system') {
      if (!headerEmitted) {
        headerEmitted = true
        entries.push({ kind: 'header', model: msg.model ?? '', tools: msg.tools?.length ?? 0 })
      }
      continue
    }

    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text') {
          entries.push({ kind: 'text', agent, depth, text: block.text ?? '', time: t })
        } else if (block.type === 'thinking') {
          entries.push({ kind: 'thinking', agent, depth, text: block.thinking ?? block.text ?? '', time: t })
        } else if (block.type === 'tool_use') {
          const entry: ToolEntry = {
            kind: 'tool',
            agent,
            depth,
            toolName: block.name ?? '',
            argSummary: summarizeArgs(block.name ?? '', block.input ?? {}),
            time: t,
          }
          entries.push(entry)
          if (block.id) {
            toolById.set(block.id, entry)
            if (block.name === 'Task') {
              agentByTask.set(block.id, String(block.input?.subagent_type ?? block.input?.description ?? 'sub'))
            }
          }
        }
      }
      continue
    }

    if (msg.type === 'user') {
      for (const block of msg.message?.content ?? []) {
        if (block.type !== 'tool_result') continue
        if (!block.tool_use_id) continue
        const entry = toolById.get(block.tool_use_id)
        if (!entry) continue
        entry.resultPreview = previewResult(entry.toolName, block.content)
        entry.isError = !!block.is_error
        // do NOT overwrite entry.time — tool timestamp is the tool_use initiation time
      }
      continue
    }

    if (msg.type === 'result') {
      entries.push({ kind: 'footer', durationMs: msg.duration_ms ?? 0, costUsd: msg.total_cost_usd ?? 0, time: t })
      continue
    }
  }

  return entries
}
