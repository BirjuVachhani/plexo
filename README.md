# Plexo

Plexo is a macOS download manager that speeds up downloads by splitting a file into blocks and pulling them in parallel across your available network interfaces — Wi-Fi, Ethernet, a USB-tethered phone, whatever you've got connected at once.

<!-- Demo video coming soon -->

## Why

A single TCP connection rarely saturates your real bandwidth, and if your Mac has more than one network path available (say, Wi-Fi + a phone tethered over USB), most download tools only ever use one of them at a time. Plexo probes the URL, splits the file into range-addressed blocks, and downloads them in parallel over every interface you select — binding each connection to a specific interface's IP — then reassembles the file once every block lands.

## Features

- **Multi-connection, multi-interface downloads** — splits the file into ~64 blocks (min. 4 MB each) and fans them out across worker connections bound to the network interfaces you pick, with up to 8 parallel connections per interface
- **Real interface detection** — reads actual macOS hardware ports (`networksetup`) so a tethered iPhone or Thunderbolt Bridge shows up labeled correctly, not as a bare `en0`/`en6`
- **Dynamic work-stealing** — blocks are leased from a shared pending queue, so a faster connection just keeps pulling more blocks instead of sitting idle while a slower one catches up
- **Resumable** — pausing aborts in-flight connections without losing progress; resuming re-verifies the remote file's ETag/Last-Modified first and refuses to resume (rather than silently corrupt the file) if the server-side content changed
- **Resilient** — per-block retry with exponential backoff, stall detection on dead-but-open connections, mid-download redirect following, and an upfront disk-space check before writing anything
- **Per-network customization** — rename and recolor each physical network, with preferences persisted across runs
- **Live per-connection stats** — throughput, ETA, and a visual map of which blocks are being pulled by which interface
- **Dark mode**

## How it works

1. Plexo sends a 1-byte ranged GET to the URL to check whether the server supports byte ranges (`Accept-Ranges`) and to read its size, filename, and ETag/Last-Modified.
2. If ranges are supported, the file is split into fixed-size blocks; if not, it falls back to a single-connection download.
3. One worker per requested connection binds its outgoing socket to a chosen network interface's local IP and pulls blocks from a shared queue until none remain.
4. Finished blocks are concatenated in order into the destination file once every block completes.

This is all plain Node `http`/`https` requests bound via `localAddress` — no native networking dependencies.

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

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, PR expectations, and bug report format.

## Tech stack

Electron, React 19, TypeScript, Zustand, built with `electron-vite`/`electron-builder`.

## License

MIT — see [LICENSE](LICENSE).
