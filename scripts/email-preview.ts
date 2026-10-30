// Gera o HTML dos e-mails do sistema para conferir no navegador: node scripts/run-ts.mjs scripts/email-preview.ts <pasta>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { previewMails } from '../worker/notify';

const out = process.argv[2] || '.tmp/email';
mkdirSync(out, { recursive: true });
for (const [name, html] of Object.entries(previewMails('http://localhost:4420'))) writeFileSync(join(out, `${name}.html`), html);
console.log('prévias em', out);
