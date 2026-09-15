# Plexo

Plexo is a macOS download manager that speeds up downloads by splitting a file into chunks and pulling them in parallel across your available network interfaces — Wi-Fi, Ethernet, a USB-tethered phone, whatever you've got connected at once.

https://github.com/user-attachments/assets/d1aace52-339d-4145-b0d0-c9d65245a9d4

## Why

A single TCP connection rarely saturates your real bandwidth. And if your Mac has more than one network available — Wi-Fi and a phone tethered over USB, say — most download tools will happily use one and leave the other sitting idle.

Plexo uses both at once, on the same file, and the speeds add up.

## Features

- **Multi-connection, multi-interface downloads** — splits the file into fixed 8 MB chunks and fans them out across worker connections bound to the network interfaces you pick, with up to 8 parallel connections per interface
- **Real interface detection** — reads actual macOS hardware ports (`networksetup`) so a tethered iPhone or Thunderbolt Bridge shows up labeled correctly, not as a bare `en0`/`en6`
- **Dynamic work-stealing** — chunks are leased from a shared pending queue, so a faster connection just keeps pulling more chunks instead of sitting idle while a slower one catches up
- **Resumable** — pausing aborts in-flight connections without losing progress; resuming re-verifies the remote file's ETag/Last-Modified first and refuses to resume (rather than silently corrupt the file) if the server-side content changed
- **Resilient** — per-chunk retry with exponential backoff, stall detection on dead-but-open connections, mid-download redirect following, and an upfront disk-space check before writing anything
- **Per-network customization** — rename and recolor each physical network, with preferences persisted across runs
- **Live per-connection stats** — throughput, ETA, and a grid of the whole file, colored by which network fetched each part
- **Dark mode**

## How it works

Instead of asking the server for a file, Plexo asks for _pieces_ of it — many at a time, over more than one network. Three primitives make that work.

### 1. HTTP range requests

Most servers will hand you an arbitrary slice of a file:

```http
GET /ubuntu-26.04.1-desktop-amd64.iso HTTP/1.1
Range: bytes=8388608-16777215
```

They advertise this with `Accept-Ranges: bytes` and reply `206 Partial Content`. Slices are independent, so you can request many at once, in any order, and stitch them together afterwards.

Plexo probes with a GET for `bytes=0-0` — unlike `HEAD`, a `206` proves ranges actually work. The same response carries the size, filename, and `ETag`/`Last-Modified`.

### 2. Binding a connection to one interface

Every interface has its own IP — Wi-Fi might be `192.168.1.40`, a tethered phone `172.20.10.3`. A TCP connection picks which local address it departs from, and that decides which network carries the packets:

```js
https.request({ hostname, path, localAddress: '172.20.10.3', headers: { Range } })
```

That option is the whole multi-network mechanism — no bonding, no VPN, no kernel extension, no native dependencies.

### 3. A shared queue of work

Split a 6 GB file into 8 fixed shares of 750 MB and you finish no sooner than your slowest connection. Instead, chunks go into one pending queue and each worker takes the next one as it frees up, so every network's share ends up proportional to its actual throughput.

### Putting it together

1. **Probe** — one-byte ranged GET, following redirects. No range support means a single plain connection instead.
2. **Split** — fixed 8 MB chunks.
3. **Fan out** — worker connections across your selected interfaces, up to 8 per interface and 32 total, each bound to its interface's IP.
4. **Lease** — each worker takes the next pending chunk into its own `part-N` file until the queue drains. Failed chunks go back on the queue (5 retries, 1s–15s backoff); connections that go quiet are dropped after 20s.
5. **Reassemble** — part files are streamed in order into the destination.

Pausing keeps the part files. Resuming re-checks `ETag`/`Last-Modified` and refuses rather than append to a file that changed on the server.

### Chunks vs. blocks

- A **chunk** is the unit of work — 8 MB, one range request, one `part-N` file (`Chunk #412` in the streams table).
- A **block** is one square in the progress grid, standing for several consecutive chunks.

Small chunks keep the queue balanced and retries cheap, but a 6 GB file is 768 of them — too many to draw. The grid groups them into a count derived from file size alone, so the number of squares tracks how big the download is and doesn't change when you resize; resizing only rewraps them. Hover a square to see which chunks it covers.

## Running it

No prebuilt releases yet — clone and run it locally, or build the app yourself.

Requirements: Node.js, npm, macOS (interface detection relies on macOS's `networksetup`, so other platforms aren't supported yet).

```bash
git clone https://github.com/anmolkapil/plexo.git
cd plexo
npm install
npm run dev
```

### Building the app

```bash
npm run build:mac
```

This builds `dist/mac/Plexo.app` locally, unsigned (no Apple Developer certificate). Since you built it yourself, macOS won't quarantine it and Gatekeeper won't complain — Gatekeeper only checks signatures on files that were downloaded via a browser/curl/etc., which is what sets the quarantine flag in the first place. A locally built app never gets that flag.

Windows and Linux build scripts exist (`build:win`, `build:linux`) but are untested — Plexo has only been developed and verified on macOS.

### Tethering an Android phone over USB

macOS has no built-in RNDIS driver, so an Android phone with USB tethering enabled won't show up as a network interface out of the box (this is also why the old `HoRNDIS` kext stopped working on modern macOS/Apple Silicon). To get an Android phone recognized as an interface Plexo can use, install **[TetherKit](https://github.com/XiaoMiku01/TetherKit)** — a kext-free, user-space RNDIS driver by [@XiaoMiku01](https://github.com/XiaoMiku01):

```bash
brew install XiaoMiku01/tap/tetherkit
```

Once connected via TetherKit, the phone shows up as a regular interface and Plexo can route chunks through it like any other network. Thanks to XiaoMiku01 for building and open-sourcing it.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, PR expectations, and bug report format.

## Tech stack

Electron, React 19, TypeScript, Zustand, built with `electron-vite`/`electron-builder`.

## License

MIT — see [LICENSE](LICENSE).
