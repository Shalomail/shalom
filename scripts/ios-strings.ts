// Textos do app de iOS: os do app web (web/src/i18n, as 15 línguas) somados aos que só existem no iPhone
// (ios/strings/ios.ts), um JSON por idioma em ios/ShalomMail/Resources/Strings. Chaves achatadas
// ("auth.signIn"); plural fica como objeto { one, other, ... }. Rodar de novo sempre que um texto mudar.
// Rodar: node scripts/run-ts.mjs scripts/ios-strings.ts
import { writeFileSync } from 'node:fs';
import ios from '../ios/strings/ios';
import { pt } from '../web/src/i18n/pt';

const LANGS = ['pt', 'en', 'es', 'fr', 'de', 'it', 'ru', 'uk', 'tr', 'he', 'ar', 'hi', 'zh', 'ja', 'ko'] as const;
type Node = string | { [k: string]: Node };
const isPlural = (v: unknown) => typeof v === 'object' && v !== null && 'other' in v && Object.values(v).every(x => typeof x === 'string');

function flatten(obj: Record<string, Node>, prefix = '', out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || isPlural(v)) out[key] = v;
    else flatten(v as Record<string, Node>, key, out);
  }
  return out;
}

let total = 0;
for (const lang of LANGS) {
  const dict = lang === 'pt' ? pt : (await import(`../web/src/i18n/${lang}.ts`)).default;
  const flat = flatten(dict as Record<string, Node>);
  for (const [k, e] of Object.entries(ios)) flat[k] = e[lang];
  writeFileSync(`ios/ShalomMail/Resources/Strings/${lang}.json`, JSON.stringify(flat) + '\n');
  total = Object.keys(flat).length;
}
console.log(`${LANGS.length} idiomas, ${total} textos cada, em ios/ShalomMail/Resources/Strings`);
