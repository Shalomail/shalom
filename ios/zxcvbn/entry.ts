// O mesmo medidor de força de senha do site (web/src/lib/password.ts), empacotado para o JavaScriptCore do
// app: dicionários comuns e em português. Gerado por scripts/ios-zxcvbn.mjs em ios/ShalomMail/Resources/zxcvbn.js.
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as ptbr from '@zxcvbn-ts/language-pt-br';
import { rate } from '../../shared/password';

const checker = new ZxcvbnFactory({
  translations: ptbr.translations,
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...ptbr.dictionary },
  // Só os primeiros 64 caracteres (a repetição além disso é medida em shared/password.ts); recusar por eles erra para o lado
  // seguro. Acima disso cada conta custava segundos.
  maxLength: 64,
});

// Nota de 0 a 4 e se é fácil demais, pela regra de shared/password.ts (a mesma do site).
(globalThis as { shalomStrength?: unknown }).shalomStrength = (pw: string, inputs: string[]) => rate(checker, pw, inputs);
