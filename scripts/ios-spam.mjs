// Empacota a regra de spam do aparelho (ios/spam/entry.ts, sobre shared/spam.ts) num arquivo só para o app de
// iOS, que roda no JavaScriptCore. Rodar de novo quando mudar shared/spam.ts.
//   node scripts/ios-spam.mjs
import { build } from 'esbuild';

const out = 'ios/ShalomMail/Resources/spam.js';
await build({ entryPoints: ['ios/spam/entry.ts'], bundle: true, format: 'iife', target: 'es2020', minify: true, outfile: out, legalComments: 'none' });
console.log(`pronto: ${out}`);
