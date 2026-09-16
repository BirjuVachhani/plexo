import type { DownloadState } from '@shared/types'
import { useState } from 'react'
import {
  DANGER,
  FONT_MONO,
  FONT_UI,
  footerStyle,
  footerTextStyle,
  primaryButtonStyle,
  secondaryButtonStyle
} from '../theme'
import { describeError, fileExtensionBadge, formatBytes } from '../utils/format'

export function ErrorScreen({
  download,
  onNewDownload,
  onDownloadAgain
}: {
  download: DownloadState
  onNewDownload: () => void
  onDownloadAgain: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const cancelled = download.status === 'cancelled'
  const knownSize = download.totalBytes > 0
  const percent = knownSize
    ? Math.min(100, Math.round((download.bytesDownloaded / download.totalBytes) * 100))
    : 0

  const handleCopyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(download.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore clipboard write failures
    }
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 20px'
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: '100%',
            borderRadius: 14,
            padding: '28px 24px',
            background: 'var(--bg-secondary)',
            border: '0.5px solid var(--border-strong)',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 18,
            textAlign: 'center'
          }}
        >
          {/* Status Icon */}
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: cancelled ? 'var(--color-usb-bg)' : 'var(--color-danger-bg)',
              border: `1px solid ${cancelled ? 'var(--color-usb-border)' : 'var(--color-danger-border)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {cancelled ? (
              <svg viewBox="0 0 24 24" style={{ width: 22, height: 22 }}>
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="var(--color-usb-text)"
                  strokeWidth="2"
                />
                <line
                  x1="8"
                  y1="12"
                  x2="16"
                  y2="12"
                  stroke="var(--color-usb-text)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" style={{ width: 22, height: 22 }}>
                <circle cx="12" cy="12" r="9" fill="none" stroke={DANGER} strokeWidth="2" />
                <line
                  x1="12"
                  y1="8"
                  x2="12"
                  y2="12.5"
                  stroke={DANGER}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="15.5" r="1.2" fill={DANGER} />
              </svg>
            )}
          </div>

          {/* Heading */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ font: `700 17px/1.2 ${FONT_UI}`, color: 'var(--text)' }}>
              {cancelled ? 'Download Cancelled' : 'Download Failed'}
            </div>
            <div style={{ font: `12px/1.4 ${FONT_UI}`, color: 'var(--text-secondary)' }}>
              {cancelled
                ? 'The download was stopped before finishing.'
                : download.error
                  ? describeError(download.error)
                  : 'An error occurred during transfer.'}
            </div>
          </div>

          {/* File capsule */}
          <div
            style={{
              width: '100%',
              borderRadius: 9,
              padding: '10px 12px',
              background: 'var(--bg)',
              border: '0.5px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              textAlign: 'left'
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 7,
                background: 'var(--bg-secondary)',
                border: '0.5px solid var(--border-strong)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                font: `600 8.5px/1 ${FONT_MONO}`,
                color: 'var(--text-secondary)',
                flexShrink: 0
              }}
            >
              {fileExtensionBadge(download.fileName)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  font: `600 12.5px/1.3 ${FONT_UI}`,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={download.fileName}
              >
                {download.fileName}
              </div>
              <div
                style={{
                  marginTop: 2,
                  font: `11px/1 ${FONT_MONO}`,
                  color: 'var(--text-tertiary)',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {download.bytesDownloaded > 0 ? (
                  <>
                    {formatBytes(download.bytesDownloaded)}
                    {knownSize
                      ? ` of ${formatBytes(download.totalBytes)} (${percent}%)`
                      : ' transferred'}
                  </>
                ) : (
                  'No data transferred'
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons in Center */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              width: '100%',
              justifyContent: 'center',
              marginTop: 4
            }}
          >
            <button
              type="button"
              onClick={onDownloadAgain}
              style={{
                ...primaryButtonStyle,
                padding: '9px 22px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>Download Again</span>
            </button>
            <button
              type="button"
              onClick={onNewDownload}
              style={{
                ...secondaryButtonStyle,
                padding: '9px 18px'
              }}
            >
              New Download
            </button>
          </div>
        </div>
      </div>

      {/* Footer with properly constrained, non-overflowing URL */}
      <div style={{ ...footerStyle, minWidth: 0 }}>
        <div
          style={{
            ...footerTextStyle,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={download.url}
        >
          {download.url}
        </div>
        <button
          type="button"
          onClick={handleCopyUrl}
          style={{
            border: 'none',
            background: 'none',
            font: `500 11px/1 ${FONT_MONO}`,
            color: copied ? 'var(--color-success)' : 'var(--color-accent)',
            cursor: 'pointer',
            padding: '2px 4px',
            flexShrink: 0
          }}
        >
          {copied ? 'Copied' : 'Copy URL'}
        </button>
      </div>
    </div>
  )
}
