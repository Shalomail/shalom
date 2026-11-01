// O mesmo medidor de força de senha do site (web/src/lib/password.ts), empacotado para o JavaScriptCore do
// app: dicionários comuns e em português. Gerado por scripts/ios-zxcvbn.mjs em ios/ShalomMail/Resources/zxcvbn.js.
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as ptbr from '@zxcvbn-ts/language-pt-br';

const checker = new ZxcvbnFactory({
  translations: ptbr.translations,
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...ptbr.dictionary },
});

// Nota de 0 a 4 e se é fácil demais: nota 0, ou nota 1 vinda de palavra, sequência, data ou do próprio nome
// (a mesma regra de web/src/lib/password.ts). Senha curta só aleatória não é "fácil demais".
(globalThis as { shalomStrength?: unknown }).shalomStrength = (pw: string, inputs: string[]) => {
  const r = checker.check(pw, [...inputs.filter(Boolean), 'shalom', 'shalomail']);
  return { score: r.score, easy: r.score === 0 || (r.score === 1 && r.sequence.some(m => m.pattern !== 'bruteforce')) };
};
