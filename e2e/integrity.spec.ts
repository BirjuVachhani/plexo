import { BLOCK, expect, test } from './fixtures'
import { seededBytes, type Fault } from './origin'

// B. A misbehaving server or network. The rule every case here must satisfy — enforced by the
// automatic checks in fixtures.ts — is that a download never ends `completed` with wrong bytes:
// it either retries its way to the exact file, or it errors and leaves nothing behind.

const SIZE = 16 * BLOCK

/** Faults a real server or network produces, applied to the first few chunk requests only. */
const TRANSIENT: [string, Fault][] = [
  ['Content-Range starts at the wrong byte', 'wrongStart'],
  ['body runs past the requested range', 'overlong'],
  ['206 without a Content-Range header', 'noContentRange'],
  ['200 (whole file) for a range that does not start at 0', 'ignoreRange'],
  ['416 Range Not Satisfiable', { status: 416 }],
  ['500 Internal Server Error', { status: 500 }],
  ['503 Service Unavailable', { status: 503 }],
  ['short body, then a clean end', { endAfter: 1000 }],
  ['connection reset partway through the body', { cutAfter: 5000 }],
  ['connection reset before any body', { cutAfter: 0 }],
  ['stall after the headers', 'stallBody'],
  ['stall before the headers', 'stallHeaders']
]

test.describe('transient server faults are retried to a correct file @smoke', () => {
  for (const [label, fault] of TRANSIENT) {
    test(label, async ({ plexo, serve }) => {
      const origin = await serve({ size: SIZE })
      let faulted = 0
      origin.setRule(({ range }) => (range && range.start > 0 && faulted++ < 3 ? fault : 'ok'))

      await plexo.start(origin.url(), origin.sha256, { connections: 2 })
      const state = await plexo.waitForStatus('completed')
      expect(faulted, 'the fault was actually injected').toBeGreaterThanOrEqual(3)
      expect(state.chunks.reduce((sum, chunk) => sum + chunk.retryCount, 0)).toBeGreaterThan(0)
    })
  }

  test('random connection resets across the whole file', async ({ plexo, serve }) => {
    const origin = await serve({ size: 48 * BLOCK, seed: 11 })
    let n = 0
    // Every third chunk request dies somewhere inside its block.
    origin.setRule(({ range }) =>
      range && range.start > 0 && n++ % 3 === 0 ? { cutAfter: (n * 7919) % BLOCK } : 'ok'
    )
    await plexo.start(origin.url(), origin.sha256, { connections: 4 })
    await plexo.waitForStatus('completed')
  })
})

test.describe('permanent faults end in a clean error @smoke', () => {
  const PERMANENT: [string, Fault][] = [
    ['every chunk request fails with 500', { status: 500 }],
    ['every chunk request redirects to itself', { redirect: '/files/test.bin' }],
    ['every chunk request gets the wrong range', 'wrongStart']
  ]
  for (const [label, fault] of PERMANENT) {
    test(label, async ({ plexo, serve }) => {
      const origin = await serve({ size: SIZE })
      origin.setRule(({ range }) =>
        range && !(range.start === 0 && range.end === 0) ? fault : 'ok'
      )
      await plexo.start(origin.url(), origin.sha256, { connections: 2 })
      const state = await plexo.waitForStatus('error')
      expect(state.error).toBeTruthy()
    })
  }
})

test.describe('the file changes on the server mid-download @smoke', () => {
  const cases: [string, Omit<Parameters<typeof mutate>[0], 'origin'>][] = [
    ['same size, new ETag', { etag: '"v2"' }],
    ['same size, new Last-Modified (no ETag)', { lastModified: 'Thu, 02 Jan 2025 00:00:00 GMT' }],
    ['different size, no validators at all', { size: SIZE + BLOCK }]
  ]

  /** Republishes the file on the server, as a CDN rolling out a new version would. */
  function mutate({
    origin,
    etag,
    lastModified,
    size
  }: {
    origin: import('./origin').Origin
    etag?: string
    lastModified?: string
    size?: number
  }): void {
    origin.setContent(seededBytes(size ?? SIZE, 2), etag ?? origin.etag)
    if (lastModified) origin.lastModified = lastModified
  }

  for (const [label, change] of cases) {
    test(label, async ({ plexo, serve }) => {
      const origin = await serve({
        size: SIZE,
        seed: 1,
        etag: change.etag ? '"v1"' : null,
        lastModified: change.lastModified ? 'Wed, 01 Jan 2025 00:00:00 GMT' : null
      })
      const reached = origin.hold(3 * BLOCK + 100)
      await plexo.start(origin.url(), origin.sha256, { connections: 2 })
      await reached
      mutate({ origin, ...change })
      origin.release()

      // Never a file stitched from two versions: the download stops with a clear reason.
      const state = await plexo.waitForStatus(['completed', 'error'])
      expect(state.status).toBe('error')
      expect(state.error).toMatch(/changed during the download/)
    })
  }
})
