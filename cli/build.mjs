// Junta o CLI e a biblioteca em arquivos únicos, sem dependências na hora de instalar.
// node cli/build.mjs
import { build } from 'esbuild';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node20', minify: true, legalComments: 'none', define: { __VERSION__: JSON.stringify(version) } };
// O comando (shalom e shalomail) e a biblioteca (import { Agent } from 'shalomail'), com os tipos escritos à mão.
await build({ ...common, entryPoints: [join(here, 'src/main.ts')], outfile: join(here, 'dist/shalom.mjs'), banner: { js: '#!/usr/bin/env node' } });
await build({ ...common, entryPoints: [join(here, 'src/sdk.ts')], outfile: join(here, 'dist/index.mjs') });
copyFileSync(join(here, 'index.d.ts'), join(here, 'dist/index.d.ts'));
console.log(`dist/shalom.mjs, dist/index.mjs ${version}`);
