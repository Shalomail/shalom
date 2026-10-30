// Roda um script TypeScript do projeto: empacota com esbuild em .tmp e executa no Node.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

const entry = process.argv[2];
const out = `.tmp/${basename(entry).replace(/\.ts$/, '.mjs')}`;
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: out, logLevel: 'warning' });
const r = spawnSync(process.execPath, [out, ...process.argv.slice(3)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
