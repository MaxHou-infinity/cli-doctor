/**
 * Build the browser half of the bundle plugin.
 *
 * `src/client/index.jsx` is bundled with esbuild into a single CommonJS chunk
 * (platform browser, `react` / `react/jsx-runtime` left external) and wrapped in
 * the loader shell every DSH client plugin uses, so the result is one file the
 * Web GUI can serve at `/plugins/<id>/client.js`:
 *
 *     window.__ModuleLoader__.load({ id: "<package.json name>", factory: (require) => {
 *       var module = { exports: {} };
 *       var exports = module.exports;
 *       ...   // esbuild CJS chunk
 *       return module.exports;
 *     } });
 *
 * Then it runs the purity gate from CONTRACT.md §3.2: every `require("…")`
 * literal in the emitted file must be `react` or `react/jsx-runtime`, because
 * those are the only modules this plugin is allowed to take from the browser
 * module table. A violation fails the build before anything is written.
 *
 * The script writes exactly one file, `lib/client.js`, and skips the write when
 * the content is unchanged, so repeated builds are idempotent.
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(PACKAGE_ROOT, 'src', 'client', 'index.jsx');
const OUTPUT = path.join(PACKAGE_ROOT, 'lib', 'client.js');

/** Modules the browser module table offers this plugin (CONTRACT.md §3.2). */
const ALLOWED_REQUIRES = new Set(['react', 'react/jsx-runtime']);

const REQUIRE_CALL = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/;

/**
 * Collect every static `require("…")` literal in a chunk.
 *
 * @param source - emitted JavaScript.
 * @returns the requested module ids, in source order.
 */
function collectRequires(source) {
  const found = [];
  REQUIRE_CALL.lastIndex = 0;
  let match;
  while ((match = REQUIRE_CALL.exec(source)) !== null) found.push(match[2]);
  return found;
}

/**
 * Fail the build when the chunk reaches outside the browser module table.
 *
 * @param source - the complete emitted file (shell included).
 * @param label - what is being checked, for the error message.
 */
function assertPure(source, label) {
  const requested = collectRequires(source);
  const forbidden = [...new Set(requested)].filter((id) => !ALLOWED_REQUIRES.has(id));
  if (forbidden.length) {
    throw new Error(`${label}: forbidden require() target(s): ${forbidden.join(', ')}; allowed: ${[...ALLOWED_REQUIRES].join(', ')}`);
  }
  if (DYNAMIC_IMPORT.test(source)) {
    throw new Error(`${label}: dynamic import() is not allowed in the client bundle`);
  }
  return requested;
}

/** Wrap an esbuild CJS chunk in the DSH client loader shell. */
function wrapClientBundle(id, chunk) {
  const body = chunk.replace(/\n+$/, '').replace(/^(?!$)/gm, '\t');
  return `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
\tvar module = { exports: {} };
\tvar exports = module.exports;
${body}
\treturn module.exports;
} });
`;
}

/** Entry point. */
async function main() {
  const manifest = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  if (typeof manifest.name !== 'string' || !manifest.name) {
    throw new Error('package.json has no "name"; the loader id cannot be derived');
  }

  const result = await build({
    entryPoints: [ENTRY],
    outfile: OUTPUT,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    external: [...ALLOWED_REQUIRES],
    define: { __CLI_DOCTOR_VERSION__: JSON.stringify(String(manifest.version || '')) },
  });

  if (result.outputFiles.length !== 1) {
    throw new Error(`expected exactly one output chunk, got ${result.outputFiles.length}`);
  }
  const chunk = result.outputFiles[0].text;
  assertPure(chunk, 'client chunk');

  const output = wrapClientBundle(manifest.name, chunk);
  assertPure(output, 'lib/client.js');

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  const previous = await readFile(OUTPUT, 'utf8').catch(() => null);
  if (previous === output) {
    process.stdout.write(`build:client ok — lib/client.js unchanged (${Buffer.byteLength(output)} bytes, id=${manifest.name})\n`);
    return;
  }
  await writeFile(OUTPUT, output, 'utf8');
  process.stdout.write(`build:client ok — wrote lib/client.js (${Buffer.byteLength(output)} bytes, id=${manifest.name})\n`);
}

main().catch((error) => {
  process.stderr.write(`build:client failed — ${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
