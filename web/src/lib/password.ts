// Senha: mínimo de 6 caracteres e recusa só as muito fáceis de adivinhar: nota 0 do zxcvbn, ou nota 1 vinda
// de palavra, sequência, data ou do próprio nome (12345678, senha123, nome com ano). Pela conta do zxcvbn,
// toda senha de 6 caracteres tem nota 1, até uma aleatória; essa passa. Decisão do Thomaz em 31/10, depois
// da auditoria; antes o zxcvbn só sugeria. Acima disso, ele mostra a força e uma dica, sem bloquear.
// A regra fica em shared/password.ts, a mesma do app de iOS (ios/zxcvbn/entry.ts).
// Os dicionários só carregam na tela de cadastro.
import type { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { useEffect, useState } from 'react';
import { rate, tooShort } from '../../../shared/password';
import { t } from '../i18n';

let checker: Promise<ZxcvbnFactory> | null = null;

export function loadChecker() {
  checker ??= (async () => {
    const [{ ZxcvbnFactory }, common, ptbr] = await Promise.all([
      import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common'), import('@zxcvbn-ts/language-pt-br'),
    ]);
    return new ZxcvbnFactory({
      translations: ptbr.translations,
      graphs: common.adjacencyGraphs,
      dictionary: { ...common.dictionary, ...ptbr.dictionary },
      // Só os primeiros 64 caracteres (a repetição além disso é medida em shared/password.ts); recusar por eles erra para o lado
      // seguro. Acima disso cada conta custava segundos.
      maxLength: 64,
    });
  })();
  return checker;
}

export type Strength = { ok: boolean; score: 0 | 1 | 2 | 3; hint: string };

export async function strength(pw: string, inputs: string[]): Promise<Strength> {
  if (tooShort(pw)) return { ok: false, score: 0, hint: t('pw.min') };
  const r = rate(await loadChecker(), pw, inputs);
  if (r.easy) return { ok: false, score: 0, hint: t('pw.weak') };
  if (r.score <= 1) return { ok: true, score: 0, hint: t('pw.fair') };
  if (r.score === 2) return { ok: true, score: 1, hint: t('pw.fair') };
  return r.score === 3 ? { ok: true, score: 2, hint: t('pw.good') } : { ok: true, score: 3, hint: t('pw.strong') };
}

// A força da senha enquanto a pessoa digita (null antes da primeira conta ou com o campo vazio).
export function usePasswordStrength(pw: string, inputs: string[]): Strength | null {
  const [s, setS] = useState<Strength | null>(null);
  const key = inputs.join('\n');
  useEffect(() => {
    if (!pw) { setS(null); return; }
    let gone = false;
    const wait = setTimeout(() => { strength(pw, inputs).then(r => { if (!gone) setS(r); }); }, 250);
    return () => { gone = true; clearTimeout(wait); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pw, key]);
  return s;
}
