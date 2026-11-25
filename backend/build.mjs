// Bundles each Lambda into a single small ESM file. The AWS SDK v3 is provided by the
// nodejs22.x Lambda runtime, so it is marked external to keep bundles tiny (faster cold starts).
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  external: ['@aws-sdk/*'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
};
await build({ ...common, entryPoints: ['src/aws/httpHandler.ts'], outfile: 'dist/http/index.mjs' });
await build({ ...common, entryPoints: ['src/aws/wsHandler.ts'], outfile: 'dist/ws/index.mjs' });
console.log('Built dist/http/index.mjs and dist/ws/index.mjs');
