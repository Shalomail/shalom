// Confere, com o código do site, a mensagem que o app de iOS mandou da marina para a lia no Worker local:
// remetente lacrado conferido, impressão do corpo e o texto. Rodar depois do teste testSendToShalomAccount.
// Rodar: SHALOM_PASSWORD=<senha das contas do seed> node scripts/run-ts.mjs scripts/ios-e2e-check.ts
import PostalMime from 'postal-mime';
import type { MessageHead } from '../shared/head';
import { bodyHash, unpack } from '../shared/pack';
import { fromB64, toB64 } from '../shared/seal';
import { openFromSender } from '../shared/sender';
import { openEnvelope, passwordKeys } from '../web/src/lib/keys';

const BASE = process.env.SHALOM_API || 'http://127.0.0.1:8790';
const PASSWORD = process.env.SHALOM_PASSWORD;
if (!PASSWORD) throw new Error('falta SHALOM_PASSWORD (a senha das contas de teste do seed)');
const jar: string[] = [];
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-shalom': '1', cookie: jar.join('; ') }, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) jar.push(c.split(';')[0]);
  return r;
};
const address = 'lia@shalomail.com';
const { salt, kdf } = await (await call('POST', '/api/auth/salt', { address })).json() as any;
const { authKey, wrapKey } = await passwordKeys(PASSWORD, fromB64(salt), kdf);
const login = await (await call('POST', '/api/auth/login', { address, authKey: toB64(authKey) })).json() as any;
const secret = await openEnvelope(login.envelope, wrapKey);
const cert = fromB64(((await (await call('GET', '/api/auth/config')).json()) as any).certKey);
const { messages } = await (await call('GET', '/api/messages?folder=inbox&limit=20')).json() as any;
let found = false;
for (const m of messages) {
  if (Date.now() - m.received_at > 10 * 60_000) continue;
  try {
    const head = await openFromSender(secret, fromB64(m.head), 'head', cert, m.received_at);
    const h = JSON.parse(new TextDecoder().decode(head.payload)) as MessageHead;
    if (h.subject !== 'Teste do iPhone') continue;
    const raw = new Uint8Array(await (await call('GET', `/api/messages/${m.id}/raw`)).arrayBuffer());
    const body = await openFromSender(secret, raw, 'raw', cert, m.received_at);
    const email = await PostalMime.parse(await unpack(body.payload));
    const hashOk = (await bodyHash(body.payload)) === h.b;
    console.log(JSON.stringify({ sender: head.sender.address, bodySender: body.sender.address, hashOk, e2e: h.e2e, t: h.t, subject: email.subject, text: email.text?.trim(), from: email.from }, null, 1));
    found = head.sender.address === 'marina@shalomail.com' && body.sender.address === 'marina@shalomail.com' && hashOk && email.text?.includes('acentuação: ção') === true;
    break;
  } catch (e) { console.log('não abriu:', (e as Error).message); }
}
console.log(found ? 'OK: a lia recebeu a mensagem do iPhone, lacrada pela marina, e o site abriu.' : 'FALHOU: mensagem do iPhone não encontrada ou não conferida.');
process.exit(found ? 0 : 1);
