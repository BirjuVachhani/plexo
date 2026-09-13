import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'
import type { NetworkInterfaceInfo, NetworkInterfaceKind } from '../../shared/types'

const execFileAsync = promisify(execFile)

/**
 * macOS device names (en0, en1, ...) don't say what they are. `networksetup`
 * knows the human-readable "Hardware Port" for each device (Wi-Fi, iPhone USB,
 * Thunderbolt Bridge, ...), which is what lets us label a USB-tethered phone
 * as such instead of just "en6".
 */
async function getHardwarePortNames(): Promise<Map<string, string>> {
  const deviceToName = new Map<string, string>()
  try {
    const { stdout } = await execFileAsync('networksetup', ['-listallhardwareports'])
    const blocks = stdout.split(/\n\s*\n/)
    for (const block of blocks) {
      const portMatch = /Hardware Port:\s*(.+)/.exec(block)
      const deviceMatch = /Device:\s*(.+)/.exec(block)
      if (portMatch && deviceMatch) {
        deviceToName.set(deviceMatch[1].trim(), portMatch[1].trim())
      }
    }
  } catch {
    // networksetup missing or failed — callers fall back to raw device names.
  }
  return deviceToName
}

function classifyInterface(hardwarePortName: string): NetworkInterfaceKind {
  const name = hardwarePortName.toLowerCase()
  if (name.includes('wi-fi') || name.includes('airport')) return 'wifi'
  if (name.includes('iphone') || name.includes('ipad') || name.includes('usb')) return 'usb'
  if (name.includes('bridge')) return 'bridge'
  if (name.includes('ethernet') || name.includes('lan')) return 'ethernet'
  return 'other'
}

/**
 * Active, externally-routable IPv4 interfaces on this Mac. Each one has its
 * own local IP, which is what lets us bind a download's outgoing connection
 * to a specific interface (see chunkDownloader's `localAddress` option).
 */
export async function listActiveInterfaces(): Promise<NetworkInterfaceInfo[]> {
  const hardwarePorts = await getHardwarePortNames()
  const all = networkInterfaces()
  const result: NetworkInterfaceInfo[] = []

  for (const [device, addresses] of Object.entries(all)) {
    if (!addresses) continue
    const ipv4 = addresses.find((addr) => addr.family === 'IPv4' && !addr.internal)
    if (!ipv4) continue

    const hardwareName = hardwarePorts.get(device)
    result.push({
      id: device,
      device,
      displayName: hardwareName ?? device,
      address: ipv4.address,
      kind: classifyInterface(hardwareName ?? ''),
      mac: ipv4.mac && ipv4.mac !== '00:00:00:00:00:00' ? ipv4.mac : undefined
    })
  }

  return result
}
