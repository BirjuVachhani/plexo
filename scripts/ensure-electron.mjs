// Electron's binary download can silently fail during `npm install` (network, interrupted install).
// Without it, `electron-vite dev` dies with "Electron uninstall". Re-run the installer if it's missing.
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

if (!existsSync('node_modules/electron/path.txt')) {
  console.log('Electron binary missing, downloading...')
  execFileSync(process.execPath, ['node_modules/electron/install.js'], { stdio: 'inherit' })
}
