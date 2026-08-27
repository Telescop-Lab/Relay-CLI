import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const cliRoot = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(cliRoot, 'package.json'), 'utf8'))

// Remove any stale tsc artifacts so dist contains only the single-file bundle.
rmSync(path.join(cliRoot, 'dist'), { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/index.cjs',
  define: {
    // Bake the package version into the bundle so the runtime never needs to
    // locate package.json relative to the output file.
    'process.env.RELAY_CLI_VERSION': JSON.stringify(pkg.version ?? '0.0.0'),
  },
  // Optional native keychain integration is loaded lazily at runtime (try/catch);
  // keep it external so the single-file bundle never hard-requires a native addon.
  external: ['keytar'],
  minify: true,
  sourcemap: false,
  logLevel: 'info',
})
