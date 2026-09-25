import { BLOCK, expect, test } from './fixtures'

// N. How many streams a download runs, decided while it runs (see concurrency.ts), against a
// server that limits it in each of the ways that matter.

test.describe('automatic stream count', () => {
  test.use({ appEnv: { PLEXO_E2E_PROBE_MS: '400' } })

  const peakStreams = (plexo: { sessions: { chunks: unknown[] }[][] }): number =>
    Math.max(...plexo.sessions.at(-1)!.map((state) => state.chunks.length))

  test('a server that caps each connection gets more of them, up to the limit', async ({
    plexo,
    serve
  }) => {
    const origin = await serve({ size: 192 * BLOCK, bytesPerSecond: 256 * 1024 })
    await plexo.start(origin.url(), origin.sha256, { connections: 'auto' })
    const state = await plexo.waitForStatus('completed', 30_000)
    expect(state.chunks).toHaveLength(16)
  })

  test('a full link keeps the streams it started with: more are tried, then retired', async ({
    plexo,
    serve
  }) => {
    const origin = await serve({ size: 64 * BLOCK, sharedBytesPerSecond: 1_000_000 })
    await plexo.start(origin.url(), origin.sha256, { connections: 'auto' })
    const state = await plexo.waitForStatus('completed', 30_000)
    expect(peakStreams(plexo), 'more streams were tried').toBe(8)
    expect(state.chunks).toHaveLength(4)
  })

  test('a server that turns extra connections away keeps the ones it accepted', async ({
    plexo,
    serve
  }) => {
    const origin = await serve({ size: 64 * BLOCK, bytesPerSecond: 256 * 1024 })
    const accepted = new Set<number>()
    origin.setRule(({ connection, range }) => {
      if (range?.start === 0 && range.end === 0) return undefined // the probe
      if (accepted.has(connection) || accepted.size < 4) {
        accepted.add(connection)
        return undefined
      }
      return { status: 503 }
    })

    await plexo.start(origin.url(), origin.sha256, { connections: 'auto' })
    const state = await plexo.waitForStatus('completed', 30_000)
    expect(peakStreams(plexo), 'more streams were tried').toBe(8)
    expect(state.chunks).toHaveLength(4)
    expect(origin.log.some((request) => request.status === 503)).toBe(true)
  })
})
