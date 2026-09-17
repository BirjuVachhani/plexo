import type { NetworkInterfaceKind, SimulatedNetworkConfig } from '@shared/types'
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import {
  DANGER,
  FONT_MONO,
  FONT_UI,
  dangerButtonStyle,
  disabledPrimaryButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle
} from '../theme'
import { describeError, toDisplayPath } from '../utils/format'

const KIND_OPTIONS: NetworkInterfaceKind[] = ['wifi', 'usb', 'ethernet', 'bridge', 'other']
const PRESET_CONNECTIONS = [1, 2, 4, 8] as const
const MAX_SIM_NETWORKS = 4
const MBPS_TO_BYTES_PER_SEC = (1024 * 1024) / 8
const MB_TO_BYTES_PER_SEC = 1024 * 1024
const DEFAULT_ASSEMBLE_SPEED_MBPS = 6

interface SimNetworkDraft {
  key: number
  kind: NetworkInterfaceKind
  label: string
  speedMbps: number
  faultRatePercent: number
}

let nextKey = 0
function makeDraft(kind: NetworkInterfaceKind, label: string, speedMbps: number): SimNetworkDraft {
  return { key: nextKey++, kind, label, speedMbps, faultRatePercent: 0 }
}

const DEFAULT_NETWORKS: SimNetworkDraft[] = [
  makeDraft('wifi', 'Simulated Wi-Fi', 30),
  makeDraft('usb', 'Simulated USB', 12)
]

const fieldLabelStyle: React.CSSProperties = {
  font: `500 9.5px/1 ${FONT_MONO}`,
  letterSpacing: '0.12em',
  color: 'var(--text-tertiary)'
}

const rowInputStyle: React.CSSProperties = {
  border: '0.5px solid var(--border-strong)',
  borderRadius: 6,
  background: 'var(--input-bg)',
  color: 'var(--text)',
  font: `12px/1.3 ${FONT_MONO}`,
  padding: '5px 7px'
}

/**
 * Dev-only panel that exercises the whole download pipeline against a file already on disk —
 * chunking across fake networks, the block grid, retries/errors, pause/resume, assembling,
 * completion — without needing a real multi-network setup or a slow, flaky server to provoke
 * the states that are otherwise hard to reproduce on demand. Only rendered when
 * `useAppStore.isDev` is true (see App.tsx), so it never reaches a packaged build's UI.
 */
export function DevToolsPanel(): React.JSX.Element | null {
  const isDev = useAppStore((store) => store.isDev)
  const downloadsDir = useAppStore((store) => store.downloadsDir)
  const homeDir = useAppStore((store) => store.homeDir)

  const [open, setOpen] = useState(false)
  const [sourceFilePath, setSourceFilePath] = useState<string | null>(null)
  const [destinationDir, setDestinationDir] = useState('')
  const [networks, setNetworks] = useState<SimNetworkDraft[]>(DEFAULT_NETWORKS)
  const [connectionsPerNetwork, setConnectionsPerNetwork] = useState(2)
  const [slowAssemble, setSlowAssemble] = useState(true)
  const [assembleSpeedMBps, setAssembleSpeedMBps] = useState(DEFAULT_ASSEMBLE_SPEED_MBPS)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Menu item lives in the main process (see installDevMenu in src/main/index.ts) — it can't
  // reach this component's state directly, so it round-trips through IPC instead.
  useEffect(() => {
    if (!isDev) return
    return window.plexo.onToggleDevToolsPanel(() => setOpen((v) => !v))
  }, [isDev])

  if (!isDev) return null

  const effectiveDestinationDir = destinationDir || downloadsDir

  const handleChooseFile = async (): Promise<void> => {
    const chosen = await window.plexo.chooseSourceFile()
    if (chosen) setSourceFilePath(chosen)
  }

  const handleChooseDestination = async (): Promise<void> => {
    const chosen = await window.plexo.chooseDestinationFolder(effectiveDestinationDir)
    if (chosen) setDestinationDir(chosen)
  }

  const updateNetwork = (key: number, patch: Partial<SimNetworkDraft>): void => {
    setNetworks((prev) => prev.map((n) => (n.key === key ? { ...n, ...patch } : n)))
  }

  const addNetwork = (): void => {
    if (networks.length >= MAX_SIM_NETWORKS) return
    setNetworks((prev) => [
      ...prev,
      makeDraft('ethernet', `Simulated Network ${prev.length + 1}`, 20)
    ])
  }

  const removeNetwork = (key: number): void => {
    setNetworks((prev) => (prev.length > 1 ? prev.filter((n) => n.key !== key) : prev))
  }

  const canStart = Boolean(sourceFilePath) && Boolean(effectiveDestinationDir) && !starting

  const handleStart = async (): Promise<void> => {
    if (!sourceFilePath || !effectiveDestinationDir) return
    setStarting(true)
    setError(null)
    try {
      const simulatedNetworks: SimulatedNetworkConfig[] = networks.map((n) => ({
        kind: n.kind,
        label: n.label.trim() || 'Simulated Network',
        speedBytesPerSec: Math.max(1, Math.round(n.speedMbps * MBPS_TO_BYTES_PER_SEC)),
        faultRatePercent: Math.min(100, Math.max(0, n.faultRatePercent))
      }))
      await window.plexo.startSimulatedDownload({
        sourceFilePath,
        destinationDir: effectiveDestinationDir,
        networks: simulatedNetworks,
        chunkCount: networks.length * connectionsPerNetwork,
        connectionsPerNetwork,
        assembleSpeedBytesPerSec: slowAssemble
          ? Math.max(1, Math.round(assembleSpeedMBps * MB_TO_BYTES_PER_SEC))
          : undefined
      })
      setOpen(false)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-start',
            padding: 14
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            style={{
              width: 380,
              maxHeight: 'calc(100% - 60px)',
              overflowY: 'auto',
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border-strong)',
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 8px 30px rgba(0,0,0,0.4)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ font: `700 13px/1.2 ${FONT_UI}`, color: 'var(--text)' }}>
                Simulate a download
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  font: `600 14px/1 ${FONT_UI}`
                }}
              >
                ×
              </button>
            </div>
            <div style={{ font: `11.5px/1.4 ${FONT_UI}`, color: 'var(--text-tertiary)' }}>
              Pick a file already on disk to &quot;download&quot; it through the real pipeline —
              chunking, the block grid, pause/resume, retries, assembling — against fake networks
              you control.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={fieldLabelStyle}>SOURCE FILE</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div
                  style={{
                    ...rowInputStyle,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: sourceFilePath ? 'var(--text)' : 'var(--text-tertiary)'
                  }}
                  title={sourceFilePath ?? undefined}
                >
                  {sourceFilePath ? toDisplayPath(sourceFilePath, homeDir) : 'No file chosen'}
                </div>
                <button type="button" onClick={handleChooseFile} style={secondaryButtonStyle}>
                  Choose…
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={fieldLabelStyle}>DESTINATION</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div
                  style={{
                    ...rowInputStyle,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={effectiveDestinationDir}
                >
                  {toDisplayPath(effectiveDestinationDir, homeDir)}
                </div>
                <button
                  type="button"
                  onClick={handleChooseDestination}
                  style={secondaryButtonStyle}
                >
                  Browse…
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={fieldLabelStyle}>SIMULATED NETWORKS</div>
                <button
                  type="button"
                  onClick={addNetwork}
                  disabled={networks.length >= MAX_SIM_NETWORKS}
                  style={{
                    border: 'none',
                    background: 'none',
                    color:
                      networks.length >= MAX_SIM_NETWORKS
                        ? 'var(--text-tertiary)'
                        : 'var(--color-accent)',
                    font: `600 10.5px/1 ${FONT_MONO}`,
                    cursor: networks.length >= MAX_SIM_NETWORKS ? 'not-allowed' : 'pointer'
                  }}
                >
                  + Add network
                </button>
              </div>

              {networks.map((network) => (
                <div
                  key={network.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: 8,
                    borderRadius: 8,
                    border: '0.5px solid var(--border)',
                    background: 'var(--bg)'
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      value={network.kind}
                      onChange={(event) =>
                        updateNetwork(network.key, {
                          kind: event.target.value as NetworkInterfaceKind
                        })
                      }
                      style={{ ...rowInputStyle, flexShrink: 0 }}
                    >
                      {KIND_OPTIONS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={network.label}
                      onChange={(event) =>
                        updateNetwork(network.key, { label: event.target.value })
                      }
                      style={{ ...rowInputStyle, flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeNetwork(network.key)}
                      disabled={networks.length <= 1}
                      title="Remove network"
                      style={{
                        border: 'none',
                        background: 'none',
                        color: networks.length <= 1 ? 'var(--text-tertiary)' : DANGER,
                        cursor: networks.length <= 1 ? 'not-allowed' : 'pointer',
                        font: `600 13px/1 ${FONT_UI}`,
                        flexShrink: 0
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        flex: 1,
                        font: `10.5px/1 ${FONT_MONO}`,
                        color: 'var(--text-tertiary)'
                      }}
                    >
                      Speed
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={network.speedMbps}
                        onChange={(event) =>
                          updateNetwork(network.key, {
                            speedMbps: Number(event.target.value) || 1
                          })
                        }
                        style={{ ...rowInputStyle, width: 56 }}
                      />
                      Mbps
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        flex: 1,
                        font: `10.5px/1 ${FONT_MONO}`,
                        color: 'var(--text-tertiary)'
                      }}
                      title="Chance a chunk attempt on this network fails outright, to exercise retry/error handling"
                    >
                      Faults
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={network.faultRatePercent}
                        onChange={(event) =>
                          updateNetwork(network.key, {
                            faultRatePercent: Number(event.target.value) || 0
                          })
                        }
                        style={{ ...rowInputStyle, width: 48 }}
                      />
                      %
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={fieldLabelStyle}>CONNECTIONS PER NETWORK</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {PRESET_CONNECTIONS.map((preset) => {
                  const isSelected = connectionsPerNetwork === preset
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setConnectionsPerNetwork(preset)}
                      style={{
                        border: isSelected
                          ? '0.5px solid var(--color-accent)'
                          : '0.5px solid var(--border)',
                        borderRadius: 5,
                        background: isSelected ? 'var(--color-usb-bg)' : 'var(--track-bg)',
                        color: isSelected ? 'var(--color-usb-text)' : 'var(--text-secondary)',
                        font: `600 10.5px/1 ${FONT_MONO}`,
                        padding: '4px 8px',
                        cursor: 'pointer'
                      }}
                    >
                      {preset}×
                    </button>
                  )
                })}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 8,
                borderRadius: 8,
                border: '0.5px solid var(--border)',
                background: 'var(--bg)'
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  font: `11px/1.3 ${FONT_UI}`,
                  color: 'var(--text)',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={slowAssemble}
                  onChange={(event) => setSlowAssemble(event.target.checked)}
                />
                Simulate the assembling step
              </label>
              <div style={{ font: `10.5px/1.4 ${FONT_UI}`, color: 'var(--text-tertiary)' }}>
                Reassembly normally finishes in a blink — this throttles it so the
                &quot;assembling&quot; screen (the block grid sweep, the pulsing combine line) stays
                on screen long enough to actually watch.
              </div>
              {slowAssemble && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    font: `10.5px/1 ${FONT_MONO}`,
                    color: 'var(--text-tertiary)'
                  }}
                >
                  Assemble speed
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={assembleSpeedMBps}
                    onChange={(event) => setAssembleSpeedMBps(Number(event.target.value) || 1)}
                    style={{ ...rowInputStyle, width: 56 }}
                  />
                  MB/s
                </label>
              )}
            </div>

            {error && <div style={{ font: `11.5px/1.4 ${FONT_UI}`, color: DANGER }}>⚠ {error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setOpen(false)} style={dangerButtonStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStart}
                disabled={!canStart}
                style={canStart ? primaryButtonStyle : disabledPrimaryButtonStyle}
              >
                {starting ? 'Starting…' : 'Start simulated download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
