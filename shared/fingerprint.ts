// Impressão digital de uma chave: 30 dígitos em 6 grupos, para conferir de olho com o contato.
// SHA-256("shalom/fp/v1" || 0 || endereço || 0 || chave pública), 6 blocos de 5 bytes, cada um mod 100000.
const enc = new TextEncoder();

export async function fingerprint(address: string, publicKey: Uint8Array): Promise<string> {
  const a = enc.encode('shalom/fp/v1');
  const b = enc.encode(address.toLowerCase());
  const data = new Uint8Array(a.length + 1 + b.length + 1 + publicKey.length);
  data.set(a);
  data.set(b, a.length + 1);
  data.set(publicKey, a.length + 1 + b.length + 1);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const groups: string[] = [];
  for (let i = 0; i < 6; i++) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + h[i * 5 + j];
    groups.push(String(n % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}
