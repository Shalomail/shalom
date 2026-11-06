// Regra de força de senha, a mesma no site (web/src/lib/password.ts) e no app de iOS (ios/zxcvbn/entry.ts),
// sobre o zxcvbn já carregado. Fácil demais: nota 0, nota 1 vinda de palavra, sequência, data ou do próprio
// nome, nota até 2 com o nome ou o endereço dentro, ou o que sobra depois de tirar o nome e o endereço (mesmo
// disfarçados) ser nada ou fácil. Senha curta só aleatória não é "fácil demais".
// A senha é medida em três formas e vale a pior: como foi digitada, a NFKC sem caracteres invisíveis e essa sem
// acentos. A NFKC é a de que o Argon2id deriva a chave (web/src/lib/keys.ts e Keys.swift): sem ela, "ｐａｓｓｗｏｒｄ"
// ou "𝐬𝐞𝐧𝐡𝐚𝟏𝟐𝟑" passariam valendo "password" e "senha123". A digitada pega o caminho contrário, um caractere só
// que vira muitos na NFKC (a ligadura U+FDFA vira 18 letras). Invisíveis (U+200B, hífen suave, branco do braille)
// e acentos soltos saem só da medida; a chave continua com eles.
// Nome e endereço entram inteiros, sem acento, palavra por palavra e com as letras separadas dos números, para
// "ribeiro2026" ser fácil para Ana Ribeiro, "brandao2026" para Thaís Brandão e "silva1990" para maria.silva90.
import type { ZxcvbnFactory } from '@zxcvbn-ts/core';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '');
// Diacríticos combinantes latinos e genéricos, não as vogais do devanágari ou do tailandês.
const MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/gu;

export const plain = (pw: string) => pw.normalize('NFKC').replace(/[\p{Default_Ignorable_Code_Point}⠀]/gu, '');
const bare = (pw: string) => plain(pw).normalize('NFD').replace(MARKS, '').normalize('NFC');

// Tamanho em grafemas, como o String.count do Swift: três emojis são 3, não 6.
const graphemes = (s: string) => {
  const Seg = (Intl as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].length : [...s].length;
};

// Menos de 6, na forma digitada ou na medida.
export const tooShort = (pw: string) => graphemes(pw) < 6 || graphemes(plain(pw)) < 6;

const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz', '1234567890', '0987654321'];

function personalWords(inputs: string[]) {
  const whole = inputs.map(s => s.normalize('NFKC').toLowerCase().trim()).filter(Boolean);
  const all = [...new Set([...whole, ...whole.map(fold)])];
  const words = all.flatMap(s => {
    // Do endereço, só a parte antes do @: o domínio é o mesmo para todo mundo.
    const own = s.split('@')[0];
    const parts = own.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return [...parts, parts.join(''), ...(own.match(/\p{L}{3,}/gu) ?? []), ...own.split(/\s+/).map(x => x.replace(/[^\p{L}\p{N}]/gu, ''))];
  });
  return {
    list: [...new Set([...all, ...words.filter(w => w.length >= 3), 'shalom', 'shalomail'])],
    // Mais as fileiras do teclado, que somam pedaços e parecem fortes (qwertyuiopasdfghjklzxcvbnm).
    own: [...new Set([...words.filter(w => w.length >= 3), ...KEYBOARD])].sort((a, b) => b.length - a.length),
  };
}

const easyOf = (r: { score: number; sequence: { pattern: string }[] }) => r.score === 0 || (r.score === 1 && r.sequence.some(m => m.pattern !== 'bruteforce'));

// Disfarces comuns do nome: pontuação no meio (zan.chetta), números no lugar de letras (z4nch3tt4), letra
// repetida (zanchettta) e de trás para frente. A senha e as palavras do nome são vistas do mesmo jeito.
// Só número grudado em letra vira letra: o ano no fim (2026) continua número.
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };
// Sem lookbehind, que o Safari antes do 16.4 não tem.
const isLetter = (c?: string) => !!c && /\p{L}/u.test(c);
const unleet = (s: string) => { const a = [...s]; return a.map((c, i) => LEET[c] && (isLetter(a[i - 1]) || isLetter(a[i + 1])) ? LEET[c] : c).join(''); };
const squeeze = (s: string) => s.replace(/(\p{L})\1+/gu, '$1');
const views: ((s: string) => string)[] = [s => s, unleet, squeeze, s => squeeze(unleet(s))];

// O menor pedaço que, repetido, forma o texto inteiro, com a última cópia podendo vir cortada.
// Basta uma cópia e um pedaço de 3 ou mais caracteres dela: senha123sen vira senha123.
function unit(s: string) {
  const a = [...s];
  for (let n = 1; n <= a.length - 3; n++) if (a.every((c, i) => c === a[i % n])) return a.slice(0, n).join('');
  return s;
}

export function rate(checker: ZxcvbnFactory, pw: string, inputs: string[]) {
  const { list, own } = personalWords(inputs);
  let score = 4, easy = false;
  // Base fraca repetida: o pedaço que sobra no fim (ou no corte de 64 caracteres do zxcvbn, em ios/zxcvbn/entry.ts
  // e web/src/lib/password.ts) parece aleatório. A senha também é medida pelo menor pedaço que, repetido, a forma
  // inteira (iloveyou1iloveyou1ilo vira iloveyou1) e com cada repetição de 2 ou mais caracteres colapsada. As cópias
  // disfarçadas (caixa trocada, separador, número diferente em cada uma, número no lugar de letra ou invertida) são
  // vistas sem o disfarce: Senha123senha123SENHA123, iloveyou1iloveyou2iloveyou3 e senha123321ahnes viram a base.
  const p = plain(pw).slice(0, 256);
  const base = fold(p).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  // Número no lugar de letra só com letra dos dois lados: um lado só quebraria a repetição (senha123 viraria senhai23).
  const swap = (x: string) => [...x].map((c, i, a) => LEET[c] && isLetter(a[i - 1]) && isLetter(a[i + 1]) ? LEET[c] : c).join('');
  const leet = swap(base);
  const kept = swap(fold(p).toLowerCase());
  const mirrored = leet.length >= 8 && leet === [...leet].reverse().join('') ? [[...leet].slice(0, Math.ceil([...leet].length / 2)).join('')] : [];
  // As formas sem disfarce só contam com duas cópias inteiras ("casa 8841 vermelha casa" não é repetição), e a sem
  // números leva os números de volta no fim, para os aleatórios continuarem somando.
  const twice = (x: string) => { const c = [...x]; for (let n = 1; n <= c.length / 2; n++) if (c.every((ch, i) => ch === c[i % n])) return [c.slice(0, n).join('')]; return []; };
  const digits = base.replace(/[^\p{N}]/gu, '');
  // Fila de 3 ou mais caracteres iguais vira um só antes de colapsar as repetições (senha123!!!!... vira senha123!).
  const collapsed = p.replace(/(.)\1{2,}/gsu, '$1').replace(/(.{2,}?)\1+/gsu, '$1');
  // Acima de 64, a colapsada só conta se encolher de verdade: uma fila solta numa senha aleatória longa custaria uma
  // conta inteira a mais. Sem separadores, a repetição precisa de duas cópias inteiras; com eles (e sem caixa nem
  // número no lugar de letra), uma cópia e um pedaço bastam: senha123s3nha vira senha123, casa_montanha_casa continua.
  const forms = [pw, plain(pw), bare(pw), unit(p), ...(p.length <= 64 || collapsed.length <= p.length / 2 ? [collapsed] : []),
    ...twice(leet), ...(unit(kept) !== kept ? [unit(kept)] : []), ...twice(base.replace(/\p{N}/gu, '')).map(u => u + digits), ...mirrored];
  // O zxcvbn só olha os primeiros 64: formas iguais até ali são uma conta só.
  for (const form of new Set(forms.map(f => [...f].slice(0, 64).join('')))) {
    if (easy) break;
    const r = checker.check(form, list);
    const personal = r.sequence.some(m => m.pattern === 'dictionary' && (m as { dictionaryName?: string }).dictionaryName === 'userInputs');
    score = Math.min(score, r.score);
    easy ||= easyOf(r) || (personal && r.score <= 2);
  }
  // Nome e sobrenome juntos, com separadores ou disfarçados somam pedaços e sobem a nota: mede o que sobra
  // sem eles. Sobrar nada é fácil; sobrar pouco mas aleatório (p8Bia!zQ2 para Bia) passa.
  const skeleton = fold(bare(pw)).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const rated = new Set<string>();
  for (const view of views) {
    if (easy) break;
    const words = [...new Set(own.flatMap(w => [view(w), [...view(w)].reverse().join('')]))].filter(w => w.length >= 3).sort((a, b) => b.length - a.length);
    const seen = view(skeleton);
    let rest = seen;
    for (const w of words) rest = rest.split(w).join('');
    if (rest === seen || rated.has(rest)) continue;
    rated.add(rest);
    easy = rest.length === 0 || easyOf(checker.check(rest));
  }
  return { score, easy };
}
