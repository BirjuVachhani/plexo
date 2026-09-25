import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { NetworkInterfaceInfo } from '../src/shared/types'
import { requestOnInterface } from '../src/main/network/routes'

const iface: NetworkInterfaceInfo = {
  id: 'wifi',
  device: 'wifi',
  displayName: 'Wi-Fi',
  kind: 'wifi',
  addresses: [
    { address: '192.0.2.2', family: 4 },
    { address: '2001:db8::2', family: 6 }
  ]
}

test('AAAA-only hostname connects over IPv6 and keeps its HTTP Host header @smoke', async () => {
  let seenHost = ''
  const server = createServer((req, res) => {
    seenHost = req.headers.host ?? ''
    res.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '::1', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    const target = new URL(`http://ipv6.example.test:${port}/file`)
    const source: NetworkInterfaceInfo = {
      ...iface,
      addresses: [{ address: '::1', family: 6 }]
    }
    const { res } = await requestOnInterface({
      target,
      iface: source,
      headers: {},
      timeoutMs: 2000,
      resolveHost: async () => [{ address: '::1', family: 6 }]
    })
    let body = ''
    for await (const chunk of res) body += chunk
    expect(body).toBe('ok')
    expect(seenHost).toBe(`ipv6.example.test:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('a working route gets time to answer after an earlier route fails @smoke', async () => {
  const server = createServer((_req, res) => {
    setTimeout(() => res.end('ipv6'), 1800)
  })
  await new Promise<void>((resolve) => server.listen(0, '::1', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    const { res } = await requestOnInterface({
      target: new URL(`http://dual.example.test:${port}/`),
      iface: {
        ...iface,
        addresses: [
          { address: '127.0.0.1', family: 4 },
          { address: '::1', family: 6 }
        ]
      },
      headers: {},
      timeoutMs: 3000,
      resolveHost: async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 },
        { address: '127.0.0.2', family: 4 }
      ]
    })
    let body = ''
    for await (const chunk of res) body += chunk
    expect(body).toBe('ipv6')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('DNS resolution obeys the request deadline @smoke', async () => {
  await expect(
    requestOnInterface({
      target: new URL('http://unresolved.example.test/file'),
      iface,
      headers: {},
      timeoutMs: 100,
      resolveHost: () => new Promise(() => {})
    })
  ).rejects.toThrow('Could not resolve the download host in time')
})
