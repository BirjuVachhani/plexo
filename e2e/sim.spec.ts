import { truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SimulatedNetworkConfig } from '../src/shared/types'
import { BLOCK, expect, test } from './fixtures'
import { seededBytes, sha256 } from './origin'

// F. The dev-tool simulated download: a local file pushed through the real chunking, retry and
// assembly pipeline, with only the HTTP transfer swapped out (see simDownload.ts).

const SIZE = 40 * BLOCK

async function sourceFile(dir: string, seed: number): Promise<{ path: string; sha: string }> {
  const bytes = seededBytes(SIZE, seed)
  const path = join(dir, '..', `source-${seed}.bin`)
  await writeFile(path, bytes)
  return { path, sha: sha256(bytes) }
}

const network = (label: string, faultRatePercent = 0): SimulatedNetworkConfig => ({
  kind: 'wifi',
  label,
  speedBytesPerSec: 40e6,
  faultRatePercent
})

test.describe('simulated downloads @smoke', () => {
  test('three flaky networks (30% of attempts dropped) still produce the exact file', async ({
    plexo,
    dirs
  }) => {
    const source = await sourceFile(dirs.userData, 1)
    await plexo.startSimulated(
      {
        sourceFilePath: source.path,
        networks: [network('one', 30), network('two', 30), network('three', 30)],
        chunkCount: 6,
        connectionsPerNetwork: 2
      },
      source.sha
    )
    const state = await plexo.waitForStatus('completed', 30_000)
    expect(state.chunks.reduce((sum, chunk) => sum + chunk.retryCount, 0)).toBeGreaterThan(0)
  })

  test('a part that goes wrong during assembly fails the download and leaves nothing behind', async ({
    plexo,
    dirs
  }) => {
    const source = await sourceFile(dirs.userData, 5)
    const id = await plexo.startSimulated(
      {
        sourceFilePath: source.path,
        networks: [network('one')],
        chunkCount: 2,
        connectionsPerNetwork: 2,
        assembleSpeedBytesPerSec: SIZE / 2
      },
      source.sha
    )
    await plexo.waitForStatus('assembling')
    // The last part is still waiting its turn; cut a byte off it.
    const last = join(dirs.userData, 'downloads', id, 'parts', `part-${SIZE / BLOCK - 1}`)
    await truncate(last, BLOCK - 1)

    const state = await plexo.waitForStatus('error')
    expect(state.error).toMatch(/refusing to write a corrupt file/)
    // (the automatic checks then confirm there is no file at the destination and no parts left)
  })

  test('pause and cancel are ignored while assembling', async ({ plexo, dirs }) => {
    const source = await sourceFile(dirs.userData, 2)
    const id = await plexo.startSimulated(
      {
        sourceFilePath: source.path,
        networks: [network('one')],
        chunkCount: 2,
        connectionsPerNetwork: 2,
        assembleSpeedBytesPerSec: SIZE / 2
      },
      source.sha
    )
    await plexo.waitForStatus('assembling')
    await plexo.api.pauseDownload(id)
    await plexo.api.cancelDownload(id)
    expect((await plexo.current())?.status).toBe('assembling')
    await plexo.waitForStatus('completed')
  })
})
