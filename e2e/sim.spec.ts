import { writeFile } from 'node:fs/promises'
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
