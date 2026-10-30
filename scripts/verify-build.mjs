// Confere se o que shalomail.com entrega é o mesmo código deste repositório: lê o commit em /version.json,
// compila aqui e compara o SHA-256 de cada arquivo de código (JavaScript, CSS e a página do app) com o que o
// site serve. Qualquer pessoa pode rodar, sem conta e sem chave.
//
//   git checkout <commit de https://shalomail.com/version.json>
//   npm ci
//   node scripts/verify-build.mjs [--site https://shalomail.com]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const i = process.argv.indexOf('--site');
const site = (i >= 0 ? process.argv[i + 1] : 'https://shalomail.com').replace(/\/+$/, '');
const root = new URL('..', import.meta.url).pathname;
const sha = buf => createHash('sha256').update(buf).digest('hex');

const live = await fetch(`${site}/version.json`, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
const here = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
console.log(`No ar:  ${live?.commit ?? '(sem version.json)'}`);
console.log(`Aqui:   ${here}`);
if (live?.commit && live.commit.replace(/-dirty$/, '') !== here) {
  console.log(`\nO site está em outro commit. Rode: git checkout ${live.commit.replace(/-dirty$/, '')} && npm ci, e de novo este script.`);
  process.exit(1);
}

console.log('\nCompilando...');
execFileSync('npx', ['vite', 'build', '--config', 'web/vite.config.ts', '--logLevel', 'silent'], { cwd: root, stdio: 'inherit' });

const dist = join(root, 'dist');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = walk(dist).map(f => relative(dist, f)).filter(f => /^assets\/.+\.(js|css)$/.test(f) || f === 'app.html').sort();

let same = 0;
const diff = [];
for (const f of files) {
  const res = await fetch(`${site}/${f}`, { cache: 'no-store' });
  const remote = res.ok ? sha(Buffer.from(await res.arrayBuffer())) : null;
  if (remote === sha(readFileSync(join(dist, f)))) same++;
  else diff.push(`${f}${remote ? '' : ' (não existe no site)'}`);
}
console.log(`\n${same} de ${files.length} arquivos idênticos ao que ${site} entrega.`);
if (diff.length) {
  console.log('Diferentes:');
  for (const d of diff) console.log(`  ${d}`);
  if (live?.commit?.endsWith('-dirty')) console.log('\nO build no ar foi feito com mudanças sem commit; a comparação exata não é possível para esta versão.');
}
process.exit(diff.length ? 1 : 0);
