import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import fc from 'fast-check'
import { advanceBlock, retractBlock } from '../src/main/download/blockProgress'
import { DownloadFile } from '../src/main/download/downloadFile'
import type { BlockState } from '../src/shared/types'

// K. What a block's byte counts mean when two attempts race for it, and how range writes land
// in the one destination-side staging file.

const LENGTH = 1000
const fresh = (): BlockState => ({
  index: 0,
  rangeStart: 0,
  rangeEnd: LENGTH - 1,
  status: 'downloading',
  bytesDownloaded: 0,
  bytesByInterface: {}
})
const attributed = (block: BlockState): number =>
  Object.values(block.bytesByInterface).reduce((sum, bytes) => sum + bytes, 0)

test.describe('block progress', () => {
  test('two attempts racing count only the ground the furthest one covers', () => {
    const block = fresh()
    expect(advanceBlock(block, 'a', 300)).toBe(300)
    expect(advanceBlock(block, 'b', 200)).toBe(0) // behind: nothing new
    expect(advanceBlock(block, 'b', 500)).toBe(200) // only what goes past a
    expect(block.bytesDownloaded).toBe(500)
    expect(block.bytesByInterface).toEqual({ a: 300, b: 200 })
  })

  test('the frontier never passes the block’s end', () => {
    const block = fresh()
    advanceBlock(block, 'a', LENGTH + 500)
    expect(block.bytesDownloaded).toBe(LENGTH)
  })

  test('retracting takes the bytes off the network they came from first', () => {
    const block = fresh()
    advanceBlock(block, 'a', 300)
    advanceBlock(block, 'b', 500)
    expect(retractBlock(block, 300, 'b')).toBe(200)
    expect(block.bytesByInterface).toEqual({ a: 300 })
  })

  test('however attempts advance and retract, attribution adds up to the frontier', () => {
    const step = fc.oneof(
      fc.record({
        op: fc.constant('advance' as const),
        network: fc.constantFrom('a', 'b', 'c'),
        position: fc.integer({ min: 0, max: LENGTH + 200 })
      }),
      fc.record({
        op: fc.constant('retract' as const),
        network: fc.constantFrom('a', 'b', 'c'),
        position: fc.integer({ min: 0, max: LENGTH })
      })
    )
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const block = fresh()
        for (const { op, network, position } of steps) {
          if (op === 'advance') advanceBlock(block, network, position)
          else retractBlock(block, position, network)
          expect(attributed(block)).toBe(block.bytesDownloaded)
          expect(block.bytesDownloaded).toBeGreaterThanOrEqual(0)
          expect(block.bytesDownloaded).toBeLessThanOrEqual(LENGTH)
        }
      })
    )
  })
})

test.describe('destination-side staging file', () => {
  let dir: string
  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plexo-staging-'))
  })
  test.afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const bytes = (from: number, to: number): Buffer =>
    Buffer.from(Array.from({ length: to - from }, (_, i) => (from + i) % 251))

  test('out-of-order ranges and a hedge overwrite produce one exact file', async () => {
    const destination = join(dir, 'result.bin')
    await writeFile(destination, '')
    const file = new DownloadFile(destination, 'test-id')
    await file.create()
    await file.writeBuffers(500, [bytes(500, LENGTH)])
    await file.writeBuffers(0, [bytes(0, 600)])
    await file.writeBuffers(400, [bytes(400, LENGTH)])
    expect(await file.read(390, 20)).toEqual(bytes(390, 410))
    await file.publish(LENGTH)
    expect(await readFile(destination)).toEqual(bytes(0, LENGTH))
  })
})
