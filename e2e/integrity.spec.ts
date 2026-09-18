import { readFile } from 'node:fs/promises'
import { BLOCK, expect, test } from './fixtures'
import { seededBytes, sha256, type Fault } from './origin'

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

test('file changes on the server mid-download (same size, new ETag) @smoke', async ({
  plexo,
  serve
}) => {
  test.fail(
    true,
    'known gap: chunk responses are not checked against the probed ETag, so old and new bytes get stitched together'
  )
  const origin = await serve({ size: SIZE, seed: 1 })
  const original = origin.sha256
  const replacement = seededBytes(SIZE, 2)

  const reached = origin.hold(3 * BLOCK + 100)
  await plexo.start(origin.url(), original, { connections: 2 })
  await reached
  origin.setContent(replacement, '"v2"')
  origin.release()

  const state = await plexo.waitForStatus(['completed', 'error'])
  // Acceptable outcomes: an error, or a file that is entirely one version. Never a mix.
  if (state.status === 'completed') {
    const got = sha256(await readFile(state.destinationPath))
    expect([original, sha256(replacement)]).toContain(got)
  }
})
