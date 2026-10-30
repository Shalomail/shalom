// Senha: a única trava é o mínimo de 8 caracteres (decisão do Thomaz em 30/10). O zxcvbn, com
// dicionários em português, só sugere: mostra a força e uma dica, sem bloquear.
// Os dicionários só carregam na tela de cadastro.
import type { ZxcvbnFactory } from '@zxcvbn-ts/core';
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
    });
  })();
  return checker;
}

export type Strength = { ok: boolean; score: 0 | 1 | 2 | 3; hint: string };

export async function strength(pw: string, inputs: string[]): Promise<Strength> {
  if (pw.length < 8) return { ok: false, score: 0, hint: t('pw.min') };
  const r = (await loadChecker()).check(pw, [...inputs.filter(Boolean), 'shalom', 'shalomail']);
  if (r.score <= 1) return { ok: true, score: 0, hint: t('pw.weak') };
  if (r.score === 2) return { ok: true, score: 1, hint: t('pw.fair') };
  return r.score === 3 ? { ok: true, score: 2, hint: t('pw.good') } : { ok: true, score: 3, hint: t('pw.strong') };
}
