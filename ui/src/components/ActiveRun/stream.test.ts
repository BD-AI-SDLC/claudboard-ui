import { describe, it, expect } from 'vitest'
import { buildStream, summarizeArgs, previewResult } from './stream.js'
import type { WsEvent } from '@bosch-sdlc/protocol'

function makeTranscript(message: unknown): WsEvent {
  return {
    run_id: 'test',
    t: new Date().toISOString(),
    kind: 'transcript-message',
    payload: { message },
  }
}

describe('buildStream', () => {
  it('text-only assistant message produces one text entry with agent main and depth 0', () => {
    const events: WsEvent[] = [
      makeTranscript({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello world' }] },
      }),
    ]
    const entries = buildStream(events)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'text', agent: 'main', depth: 0, text: 'hello world' })
  })

  it('Bash tool_use paired with tool_result produces one tool entry with argSummary and resultPreview', () => {
    const events: WsEvent[] = [
      makeTranscript({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls -la\necho done' } }],
        },
      }),
      makeTranscript({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file1.txt\nfile2.txt\nfile3.txt' }],
        },
      }),
    ]
    const entries = buildStream(events)
    expect(entries).toHaveLength(1)
    const e0 = entries[0]!
    expect(e0.kind).toBe('tool')
    if (e0.kind === 'tool') {
      expect(e0.argSummary).toBe('ls -la')
      expect(e0.resultPreview).toBe('file1.txt\nfile2.txt\nfile3.txt')
    }
  })

  it('Task tool_use with child messages produces entries with sub-agent label and depth 1', () => {
    const taskId = 'task1'
    const events: WsEvent[] = [
      makeTranscript({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: taskId, name: 'Task', input: { subagent_type: 'sdd-expert-agent', description: 'run sdd' } }],
        },
      }),
      makeTranscript({
        type: 'assistant',
        parent_tool_use_id: taskId,
        message: { content: [{ type: 'text', text: 'child message 1' }] },
      }),
      makeTranscript({
        type: 'assistant',
        parent_tool_use_id: taskId,
        message: { content: [{ type: 'text', text: 'child message 2' }] },
      }),
    ]
    const entries = buildStream(events)
    // 1 task tool entry + 2 child text entries
    expect(entries).toHaveLength(3)
    const childEntries = entries.filter((e) => e.kind === 'text')
    expect(childEntries).toHaveLength(2)
    for (const e of childEntries) {
      if (e.kind === 'text') {
        expect(e.agent).toBe('sdd-expert-agent')
        expect(e.depth).toBe(1)
      }
    }
  })

  it('tool_result with is_error sets isError on the tool entry', () => {
    const events: WsEvent[] = [
      makeTranscript({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'fail' } }] },
      }),
      makeTranscript({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: 'command not found' }],
        },
      }),
    ]
    const entries = buildStream(events)
    const e0 = entries[0]!
    expect(e0.kind).toBe('tool')
    if (e0.kind === 'tool') {
      expect(e0.isError).toBe(true)
    }
  })

  it('system init followed by two more system messages produces exactly one header entry', () => {
    const events: WsEvent[] = [
      makeTranscript({ type: 'system', model: 'claude-opus-4-7', tools: ['Bash', 'Read'] }),
      makeTranscript({ type: 'system', model: 'claude-opus-4-7', tools: ['Bash', 'Read'] }),
      makeTranscript({ type: 'system', model: 'claude-opus-4-7', tools: ['Bash', 'Read'] }),
    ]
    const entries = buildStream(events)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'header', model: 'claude-opus-4-7', tools: 2 })
  })

  it('result message produces a footer entry with duration and cost', () => {
    const events: WsEvent[] = [
      makeTranscript({ type: 'result', duration_ms: 5000, total_cost_usd: 0.12 }),
    ]
    const entries = buildStream(events)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'footer', durationMs: 5000, costUsd: 0.12 })
  })
})

describe('buildStream time propagation', () => {
  const T1 = '2026-06-05T12:00:00.000Z'
  const T2 = '2026-06-05T12:00:01.000Z'
  const T3 = '2026-06-05T12:00:02.000Z'

  function makeAt(t: string, message: unknown): WsEvent {
    return { run_id: 'test', t, kind: 'transcript-message', payload: { message } }
  }

  it('text entry carries ev.t as time', () => {
    const entries = buildStream([
      makeAt(T1, { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
    ])
    expect(entries[0]).toMatchObject({ kind: 'text', time: T1 })
  })

  it('thinking entry carries ev.t as time', () => {
    const entries = buildStream([
      makeAt(T1, { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } }),
    ])
    expect(entries[0]).toMatchObject({ kind: 'thinking', time: T1 })
  })

  it('tool entry carries tool_use ev.t and does NOT update time on tool_result', () => {
    const entries = buildStream([
      makeAt(T1, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu5', name: 'Bash', input: { command: 'ls' } }] } }),
      makeAt(T2, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu5', content: 'ok' }] } }),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'tool', time: T1 })
  })

  it('footer entry carries result ev.t as time', () => {
    const entries = buildStream([
      makeAt(T3, { type: 'result', duration_ms: 1000, total_cost_usd: 0.01 }),
    ])
    expect(entries[0]).toMatchObject({ kind: 'footer', time: T3 })
  })

  it('header entry has no time field', () => {
    const entries = buildStream([
      makeAt(T1, { type: 'system', model: 'claude-opus-4-7', tools: [] }),
    ])
    expect(entries[0]).toMatchObject({ kind: 'header' })
    expect((entries[0] as { time?: string }).time).toBeUndefined()
  })
})

describe('summarizeArgs', () => {
  it('truncates Bash command to first line at 60 chars', () => {
    const long = 'a'.repeat(70)
    expect(summarizeArgs('Bash', { command: `${long}\nline2` })).toBe('a'.repeat(60) + '…')
  })

  it('returns file_path for Read', () => {
    expect(summarizeArgs('Read', { file_path: '/foo/bar.ts' })).toBe('/foo/bar.ts')
  })
})

describe('previewResult', () => {
  it('returns line count for Read tool', () => {
    expect(previewResult('Read', 'line1\nline2\nline3')).toBe('3 lines')
  })

  it('truncates to 3 lines with suffix for long results', () => {
    const result = previewResult('Bash', 'a\nb\nc\nd')
    expect(result).toContain(' …')
    expect(result.split('\n')).toHaveLength(3)
  })
})
