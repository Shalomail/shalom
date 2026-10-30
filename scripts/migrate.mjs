// Migração do Shalom Mail para outra conta Cloudflare: copia os corpos do R2 e as caixas (Durable
// Objects) do Worker de origem para o de destino, pelas rotas /api/admin, e confere as contagens. O banco
// D1 vai pelo wrangler; a ordem completa está em docs/migracao.md.
//
//   node scripts/migrate.mjs blobs  --from <url> --to <url>            copia os corpos que faltam no destino
//   node scripts/migrate.mjs boxes  --from <url> --to <url> [--merge]  copia as caixas (--merge só acrescenta)
//   node scripts/migrate.mjs verify --from <url> --to <url>            confere contas, mensagens e corpos
//
// A ADMIN_KEY sai do Keychain (shalom-prod) e vale para os dois lados; FROM_KEY e TO_KEY trocam, se
// precisar. --local usa a do .dev.vars (teste com dois Workers locais).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = name => argv.includes(`--${name}`);
const cmd = argv[0];
const from = flag('from')?.replace(/\/+$/, '');
const to = flag('to')?.replace(/\/+$/, '');
const die = msg => { console.error(msg); process.exit(1); };
if (!['blobs', 'boxes', 'verify'].includes(cmd) || !from || !to) die('Uso: node scripts/migrate.mjs <blobs|boxes|verify> --from <url> --to <url> [--merge] [--local]');
if (from === to) die('Origem e destino são o mesmo endereço.');

const keyOf = () => {
  if (has('local')) return /^ADMIN_KEY=(.+)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1]?.trim();
  try { return execFileSync('security', ['find-generic-password', '-s', 'shalom-prod', '-a', 'ADMIN_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
};
const shared = keyOf();
const keys = { [from]: process.env.FROM_KEY || shared, [to]: process.env.TO_KEY || shared };
if (!keys[from] || !keys[to]) die('Falta a ADMIN_KEY (Keychain shalom-prod, ou FROM_KEY e TO_KEY).');

// Pedido com três tentativas: uma queda de rede no meio não derruba a cópia inteira.
async function req(base, path, body, { raw = false, headers = {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}/api/admin/${path}`, {
        method: 'POST',
        headers: { 'x-shalom': '1', 'x-admin-key': keys[base], ...(raw ? headers : { 'content-type': 'application/json' }) },
        body: raw ? body : JSON.stringify(body),
      });
      if (path === 'export/blob' && res.ok) return res;
      const json = await res.json().catch(() => ({}));
      if (res.status === 404 && json.message === 'Não encontrado.') die(`${base} não aceitou a ADMIN_KEY (ou ela ainda não subiu para lá).`);
      if (!res.ok) throw new Error(`${base}/${path}: ${res.status} ${json.message ?? ''}`);
      return json;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function allUsers(base) {
  const ids = [];
  for (let after = '', done = false; !done;) {
    const page = await req(base, 'export/users', { after });
    ids.push(...page.ids);
    done = page.done || !page.ids.length;
    after = page.ids[page.ids.length - 1] ?? after;
  }
  return ids;
}

async function allBlobs(base) {
  const blobs = [];
  for (let cursor = null, first = true; first || cursor; first = false) {
    const page = await req(base, 'export/blobs', { cursor });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  }
  return blobs;
}

// Vários ao mesmo tempo, sem passar de `n`.
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function blobs() {
  const list = await allBlobs(from);
  const missing = [];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const { have } = await req(to, 'import/has', { keys: chunk.map(b => b.key) });
    const got = new Set(have);
    missing.push(...chunk.filter(b => !got.has(b.key)));
  }
  console.log(`Corpos na origem: ${list.length}. Faltam no destino: ${missing.length}.`);
  let done = 0, bytes = 0;
  await pool(missing, 6, async b => {
    const res = await req(from, 'export/blob', { key: b.key });
    const body = await res.arrayBuffer();
    await req(to, 'import/blob', body, { raw: true, headers: { 'x-blob-key': b.key, ...(b.type ? { 'x-blob-type': b.type } : {}) } });
    done++; bytes += body.byteLength;
    if (done % 100 === 0 || done === missing.length) process.stdout.write(`\r  ${done}/${missing.length} (${(bytes / 1048576).toFixed(1)} MB)`);
  });
  if (missing.length) process.stdout.write('\n');
  console.log('Corpos copiados.');
}

async function boxes() {
  const mode = has('merge') ? 'merge' : 'replace';
  const ids = await allUsers(from);
  console.log(`Caixas na origem: ${ids.length} (modo ${mode === 'merge' ? 'acrescentar' : 'substituir'}).`);
  let n = 0, total = 0;
  await pool(ids, 4, async id => {
    let after = '', first = true, count = 0;
    for (let done = false; !done;) {
      const page = await req(from, 'export/box', { id, after });
      // Caixa vazia ainda passa uma vez: no modo substituir, a primeira página zera o destino.
      if (page.rows.length || first) await req(to, 'import/box', { id, rows: page.rows, mode, first });
      count += page.rows.length;
      first = false;
      done = page.done;
      after = page.rows[page.rows.length - 1]?.id ?? after;
    }
    n++; total += count;
    if (n % 25 === 0 || n === ids.length) process.stdout.write(`\r  ${n}/${ids.length} caixas, ${total} mensagens`);
  });
  process.stdout.write('\n');
  console.log('Caixas copiadas.');
}

async function verify() {
  const [a, b] = await Promise.all([allUsers(from), allUsers(to)]);
  const onlyFrom = a.filter(id => !b.includes(id));
  console.log(`Contas: origem ${a.length}, destino ${b.length}${onlyFrom.length ? `, ${onlyFrom.length} faltando no destino (copie o D1 de novo)` : ''}.`);
  let diff = 0;
  await pool(a, 6, async id => {
    const [x, y] = await Promise.all([req(from, 'tally/box', { id }), req(to, 'tally/box', { id })]);
    if (x.messages !== y.messages || x.bytes !== y.bytes) {
      diff++;
      console.log(`  diferente: ${id} origem ${x.messages} msg / ${x.bytes} B, destino ${y.messages} msg / ${y.bytes} B`);
    }
  });
  const [ba, bb] = await Promise.all([allBlobs(from), allBlobs(to)]);
  const have = new Set(bb.map(o => o.key));
  const lost = ba.filter(o => !have.has(o.key));
  const size = l => (l.reduce((s, o) => s + o.size, 0) / 1048576).toFixed(1);
  console.log(`Corpos: origem ${ba.length} (${size(ba)} MB), destino ${bb.length} (${size(bb)} MB)${lost.length ? `, ${lost.length} faltando` : ''}.`);
  const ok = !onlyFrom.length && !diff && !lost.length;
  console.log(ok ? 'Tudo igual.' : `${diff} caixa(s) diferente(s). Rode boxes e blobs de novo.`);
  process.exit(ok ? 0 : 1);
}

await ({ blobs, boxes, verify })[cmd]();
