import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const cliRoot = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(cliRoot, 'package.json'), 'utf8'))

const distDir = path.join(cliRoot, 'dist')
const bundlePath = path.join(distDir, 'index.cjs')
// Build into a sibling file and swap it in with an atomic rename. Writing
// straight to index.cjs — or clearing `dist` first, as this script used to —
// leaves a window where the bundle is missing or half-written, which breaks any
// concurrent reader. That is not hypothetical: `npm pack` re-runs this script
// through the `prepare` lifecycle, so the CLI test suites can be spawning the
// bundle at the exact moment it disappears.
const stagingPath = path.join(distDir, 'index.staging.cjs')

mkdirSync(distDir, { recursive: true })

await build({
  entryPoints: [path.join(cliRoot, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: stagingPath,
  define: {
    // Bake the package version into the bundle so the runtime never needs to
    // locate package.json relative to the output file.
    'process.env.RELAY_CLI_VERSION': JSON.stringify(pkg.version ?? '0.0.0'),
  },
  // Optional native keychain integration is loaded lazily at runtime (try/catch);
  // keep it external so the single-file bundle never hard-requires a native addon.
  external: ['@napi-rs/keyring'],
  minify: true,
  sourcemap: false,
  logLevel: 'info',
})

// On Windows the swap can fail while another process is executing (or an
// antivirus scanner is reading) the previous bundle. Retry briefly instead of
// trading a "file missing" race for a "file locked" one.
async function replaceBundle() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(stagingPath, bundlePath)
      return
    } catch (err) {
      if (attempt >= 10) throw err
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

await replaceBundle()

// Remove any stale tsc artifacts so dist contains only the single-file bundle.
// Done after the swap, so the bundle is never absent from disk.
for (const entry of readdirSync(distDir)) {
  if (entry !== 'index.cjs') {
    rmSync(path.join(distDir, entry), { recursive: true, force: true })
  }
}
