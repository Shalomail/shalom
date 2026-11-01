// Compressão sem perda (gzip) do e-mail inteiro, anexos incluídos, antes de criptografar: depois de
// criptografado não comprime mais nada. Anexo em base64 encolhe uns 25%; texto, 60 a 80%.
// Na leitura, só descomprime o que começa com a assinatura do gzip (1f 8b), então mensagens antigas,
// guardadas sem compressão, continuam abrindo.

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

// Formato atual: 00 'S' 'H' 01 | tamanho do gzip (4 bytes) | gzip | zeros até o degrau de tamanho. O servidor
// vê o tamanho do lacre; o degrau esconde o tamanho exato (que, comprimido, diria algo do conteúdo). O
// degrau cresce com a mensagem, então sobra no máximo uns 6%. E-mail nunca começa com o byte zero, então
// não se confunde com os formatos antigos (gzip puro, ou a mensagem como veio).
const MAGIC = [0x00, 0x53, 0x48, 0x01];
const step = (n: number) => Math.max(256, 2 ** (Math.ceil(Math.log2(n)) - 4));

export async function pack(bytes: Uint8Array): Promise<Uint8Array> {
  const gz = await pipe(bytes, new CompressionStream('gzip'));
  const used = MAGIC.length + 4 + gz.length;
  const out = new Uint8Array(Math.ceil(used / step(used)) * step(used));
  out.set(MAGIC);
  new DataView(out.buffer).setUint32(MAGIC.length, gz.length);
  out.set(gz, MAGIC.length + 4);
  return out;
}

export const isPacked = (bytes: Uint8Array) => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
const isFramed = (b: Uint8Array) => b.length >= 8 && MAGIC.every((x, i) => b[i] === x);

// O maior e-mail aceito tem 15 MB: abrir nunca passa de 64 MiB. Uma mensagem pequena feita para descomprimir
// em gigabytes derrubava a aba, o app ou o terminal (e o `shalom watch` voltava a ela a cada reinício).
export const MAX_UNPACKED = 64 * 1024 * 1024;

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNPACKED) { await reader.cancel(); throw new Error('Mensagem grande demais para abrir.'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export async function unpack(bytes: Uint8Array): Promise<Uint8Array> {
  if (isFramed(bytes)) {
    const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length);
    return inflate(bytes.subarray(MAGIC.length + 4, MAGIC.length + 4 + len));
  }
  return isPacked(bytes) ? inflate(bytes) : bytes;
}

// Impressão do corpo (SHA-256 do corpo já empacotado), guardada no cabeçalho lacrado pelo remetente:
// liga o cabeçalho ao corpo, para ninguém servir o assunto de uma mensagem com o corpo de outra.
export async function bodyHash(packed: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', packed as Uint8Array<ArrayBuffer>));
  let s = '';
  for (const b of d) s += String.fromCharCode(b);
  return btoa(s);
}
