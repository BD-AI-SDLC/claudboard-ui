import { jest } from '@jest/globals'

// Mock the plugin-check and installer modules BEFORE importing state.
const mockIsCliPresent = jest.fn<() => Promise<boolean>>()
const mockIsPluginInstalled = jest.fn<() => boolean>()
const mockInstallClaudboard = jest.fn<() => Promise<{ ok: boolean; stderr?: string }>>()

jest.unstable_mockModule('../plugin-check.js', () => ({
  isClaudeCliPresent: mockIsCliPresent,
  isClaudboardInstalled: mockIsPluginInstalled,
}))

jest.unstable_mockModule('../installer.js', () => ({
  installClaudboard: mockInstallClaudboard,
}))

const { getBootstrapStatus, runBootstrap, retryBootstrap, __resetForTest } =
  await import('../state.js')

beforeEach(() => {
  mockIsCliPresent.mockReset()
  mockIsPluginInstalled.mockReset()
  mockInstallClaudboard.mockReset()
  __resetForTest()
})

describe('bootstrap state machine', () => {
  it('transitions to ready when CLI present and plugin installed', async () => {
    mockIsCliPresent.mockResolvedValue(true)
    mockIsPluginInstalled.mockReturnValue(true)

    await runBootstrap()

    expect(getBootstrapStatus()).toEqual({ state: 'ready' })
    expect(mockInstallClaudboard).not.toHaveBeenCalled()
  })

  it('transitions to ready after successful install when plugin missing', async () => {
    mockIsCliPresent.mockResolvedValue(true)
    mockIsPluginInstalled.mockReturnValue(false)
    mockInstallClaudboard.mockResolvedValue({ ok: true })

    await runBootstrap()

    expect(getBootstrapStatus()).toEqual({ state: 'ready' })
    expect(mockInstallClaudboard).toHaveBeenCalledTimes(1)
  })

  it('transitions to cli-missing when claude binary absent', async () => {
    mockIsCliPresent.mockResolvedValue(false)

    await runBootstrap()

    const status = getBootstrapStatus()
    expect(status.state).toBe('cli-missing')
    expect(status.message).toContain('claude.com/download')
    expect(mockIsPluginInstalled).not.toHaveBeenCalled()
    expect(mockInstallClaudboard).not.toHaveBeenCalled()
  })

  it('transitions to install-failed with stderr tail when install fails', async () => {
    mockIsCliPresent.mockResolvedValue(true)
    mockIsPluginInstalled.mockReturnValue(false)
    mockInstallClaudboard.mockResolvedValue({ ok: false, stderr: 'network unreachable' })

    await runBootstrap()

    expect(getBootstrapStatus()).toEqual({
      state: 'install-failed',
      message: 'network unreachable',
    })
  })

  it('is idempotent: repeated runBootstrap calls do not re-spawn install when ready', async () => {
    mockIsCliPresent.mockResolvedValue(true)
    mockIsPluginInstalled.mockReturnValue(true)

    await runBootstrap()
    await runBootstrap()
    await runBootstrap()

    expect(mockIsCliPresent).toHaveBeenCalledTimes(1)
    expect(mockIsPluginInstalled).toHaveBeenCalledTimes(1)
    expect(mockInstallClaudboard).not.toHaveBeenCalled()
  })

  it('coalesces concurrent runBootstrap calls into a single install', async () => {
    mockIsCliPresent.mockResolvedValue(true)
    mockIsPluginInstalled.mockReturnValue(false)
    mockInstallClaudboard.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 10)),
    )

    await Promise.all([runBootstrap(), runBootstrap(), runBootstrap()])

    expect(mockInstallClaudboard).toHaveBeenCalledTimes(1)
  })

  it('retryBootstrap returns null from non-install-failed state', () => {
    mockIsCliPresent.mockResolvedValue(true)
    mockIsPluginInstalled.mockReturnValue(true)

    expect(retryBootstrap()).toBeNull()
  })

  it('retryBootstrap restarts the install when in install-failed state', async () => {
    mockIsCliPresent.mockResolvedValue(true)
    mockIsPluginInstalled.mockReturnValue(false)
    mockInstallClaudboard.mockResolvedValueOnce({ ok: false, stderr: 'first try failed' })
    await runBootstrap()
    expect(getBootstrapStatus().state).toBe('install-failed')

    // Second attempt succeeds
    mockInstallClaudboard.mockResolvedValueOnce({ ok: true })
    const retry = retryBootstrap()
    expect(retry).not.toBeNull()
    const status = await retry!
    // Right after retry kick-off, state is `installing` (the actual install runs async)
    expect(status.state).toBe('installing')

    // Allow the async install to settle
    await new Promise((r) => setTimeout(r, 20))
    expect(getBootstrapStatus().state).toBe('ready')
    expect(mockInstallClaudboard).toHaveBeenCalledTimes(2)
  })

  it('does not run install when current state is cli-missing', async () => {
    mockIsCliPresent.mockResolvedValueOnce(false)
    await runBootstrap()
    expect(getBootstrapStatus().state).toBe('cli-missing')

    // Subsequent call should not re-check CLI or attempt install
    await runBootstrap()
    expect(mockIsCliPresent).toHaveBeenCalledTimes(1)
    expect(mockInstallClaudboard).not.toHaveBeenCalled()
  })
})
