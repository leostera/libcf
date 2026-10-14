import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Bazel supplies declared source and output paths. This tool never deploys,
// generates resource identities, or reads an account configuration.
const [entry, output, ...extra] = process.argv.slice(2);
if (!entry || !output || extra.length) throw new Error('Expected entry point and output directory');
const wasm = new Map();
const result = await build({
  entryPoints: [entry],
  outfile: resolve(output, 'worker.mjs'),
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  platform: 'browser',
  external: ['cloudflare:*'],
  plugins: [{
    name: 'static-runtime-modules',
    setup(builder) {
      // Supplied by the Sites manifest/upload pipeline, never fabricated here.
      builder.onResolve({ filter: /^__STATIC_CONTENT_MANIFEST$/ }, () => ({
        path: '__STATIC_CONTENT_MANIFEST', external: true,
      }));
      builder.onResolve({ filter: /\.wasm$/ }, async args => {
        const bytes = await readFile(resolve(args.resolveDir, args.path));
        // Content names, not callback ordering or absolute sandbox paths, determine
        // imports. A repeated module is emitted once without an async-order race.
        const name = `${createHash('sha256').update(bytes).digest('hex')}.wasm`;
        const previous = wasm.get(name);
        if (previous && !previous.equals(bytes)) throw new Error('Wasm digest collision');
        wasm.set(name, bytes);
        return { path: `./${name}`, external: true };
      });
    },
  }],
});
const names = [...wasm.keys()].sort();
// Derive dependencies from emitted imports, not just onResolve callbacks: dead
// code must not invent a required runtime module after tree shaking.
const requiredTextModules = [...new Set(Object.values(result.metafile.outputs)
  .flatMap(output => output.imports)
  .filter(item => item.external && item.path === '__STATIC_CONTENT_MANIFEST')
  .map(item => item.path))].sort();
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'worker.mjs'), result.outputFiles[0].contents);
for (const name of names) await writeFile(resolve(output, name), wasm.get(name));
await writeFile(resolve(output, 'bundle.json'), JSON.stringify({
  schemaVersion: 2,
  mainModule: 'worker.mjs',
  wasmModules: names,
  requiredTextModules,
}) + '\n');
