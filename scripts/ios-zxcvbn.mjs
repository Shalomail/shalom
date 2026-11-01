// Empacota o medidor de força de senha (ios/zxcvbn/entry.ts) num arquivo só para o app de iOS, que roda no
// JavaScriptCore. Rodar de novo quando atualizar o @zxcvbn-ts.
//   node scripts/ios-zxcvbn.mjs
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const out = 'ios/ShalomMail/Resources/zxcvbn.js';
// O zxcvbn-ts é MIT: a licença inteira vai junto no topo do arquivo empacotado.
const license = readFileSync('node_modules/@zxcvbn-ts/core/LICENSE.txt', 'utf8').trim();
const banner = `/*! zxcvbn-ts (core, language-common, language-pt-br), https://github.com/zxcvbn-ts/zxcvbn\n\n${license.replace(/\*\//g, '* /')}\n*/`;
await build({ entryPoints: ['ios/zxcvbn/entry.ts'], bundle: true, format: 'iife', target: 'es2020', minify: true, outfile: out, legalComments: 'none', banner: { js: banner } });
console.log(`pronto: ${out}`);
