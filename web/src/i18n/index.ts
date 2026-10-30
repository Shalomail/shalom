// Idioma do app. Um dicionário por idioma (pt.ts é a origem e define as chaves; os outros são tipados
// contra ele, então faltar uma chave é erro de tipo). Português e inglês vêm no pacote; os outros
// carregam sob demanda. Trocar o idioma avisa quem usa useLocale() e o app inteiro desenha de novo.
import { useSyncExternalStore } from 'react';
import { LOCALES } from '../../../shared/locales.gen';
import { pt, type Dict, type Plural } from './pt';
import en from './en';

export type { Dict, Plural };
export type Locale = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ru' | 'uk' | 'tr' | 'he' | 'ar' | 'hi' | 'zh' | 'ja' | 'ko';

// Cada idioma no próprio nome, como no seletor do site (web/site/i18n/*.json, meta.name).
export const LANG_NAMES: Record<Locale, string> = {
  pt: 'Português', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano', ru: 'Русский',
  uk: 'Українська', tr: 'Türkçe', he: 'עברית', ar: 'العربية', hi: 'हिन्दी', zh: '简体中文', ja: '日本語', ko: '한국어',
};

const loaders: Record<Locale, () => Promise<Dict>> = {
  pt: async () => pt,
  en: async () => en,
  es: () => import('./es').then(m => m.default),
  fr: () => import('./fr').then(m => m.default),
  de: () => import('./de').then(m => m.default),
  it: () => import('./it').then(m => m.default),
  ru: () => import('./ru').then(m => m.default),
  uk: () => import('./uk').then(m => m.default),
  tr: () => import('./tr').then(m => m.default),
  he: () => import('./he').then(m => m.default),
  ar: () => import('./ar').then(m => m.default),
  hi: () => import('./hi').then(m => m.default),
  zh: () => import('./zh').then(m => m.default),
  ja: () => import('./ja').then(m => m.default),
  ko: () => import('./ko').then(m => m.default),
};

// Os mesmos 15 do site (shared/locales.gen.ts).
export const SUPPORTED = (LOCALES as string[]).filter((l): l is Locale => l in loaders);
export const isLocale = (s: unknown): s is Locale => typeof s === 'string' && (SUPPORTED as string[]).includes(s);

const STORE_KEY = 'shalom-app-lang';
const RTL = new Set<Locale>(['he', 'ar']);
// Tag do <html lang> (a mesma do site) e locale das datas e números. Árabe com algarismos ocidentais,
// como no site.
const HTML_TAG: Partial<Record<Locale, string>> = { pt: 'pt-BR', zh: 'zh-Hans' };
const INTL_TAG: Partial<Record<Locale, string>> = { pt: 'pt-BR', zh: 'zh-CN', ar: 'ar-u-nu-latn' };

let current: Locale = 'pt';
let dict: Dict = pt;
let numbers: Intl.NumberFormat | null = null;
let plural: Intl.PluralRules | null = null;
const listeners = new Set<() => void>();

export const locale = () => current;
export const intlLocale = () => INTL_TAG[current] ?? current;
export const isRtl = () => RTL.has(current);

// Escolha na ordem: o que foi salvo neste aparelho pelo app, o cookie que o site grava quando a pessoa
// escolhe o idioma no rodapé, o primeiro idioma do navegador que o app tem, inglês.
export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* sem armazenamento */ }
  const cookie = /(?:^|;\s*)shalom-lang=([a-z]{2})/.exec(document.cookie)?.[1];
  if (isLocale(cookie)) return cookie;
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of prefs) {
    const l = (tag || '').toLowerCase().split('-')[0].replace(/^iw$/, 'he');
    if (isLocale(l)) return l;
  }
  return 'en';
}

function apply(l: Locale, d: Dict) {
  current = l;
  dict = d;
  plural = null;
  numbers = null;
  const html = document.documentElement;
  html.lang = HTML_TAG[l] ?? l;
  html.dir = RTL.has(l) ? 'rtl' : 'ltr';
  listeners.forEach(fn => fn());
}

// Antes do primeiro quadro: carrega o idioma escolhido (sem rede, se não der, cai no inglês).
export async function initLocale() {
  const l = initialLocale();
  try { apply(l, await loaders[l]()); } catch { apply('en', en); }
}

// Troca pelo seletor de Configurações: vale na hora e fica salvo neste aparelho.
export async function setLocale(l: Locale) {
  const d = await loaders[l]();
  try { localStorage.setItem(STORE_KEY, l); } catch { /* vale só nesta aba */ }
  apply(l, d);
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current);
}

// ---------- Texto ----------

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends { other: string } ? never : Leaves<T[K], `${P}${K}.`>
}[keyof T & string];
type PluralLeaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? never : T[K] extends { other: string } ? `${P}${K}` : PluralLeaves<T[K], `${P}${K}.`>
}[keyof T & string];
export type Key = Leaves<Dict>;
export type PluralKey = PluralLeaves<Dict>;
export type Vars = Record<string, string | number>;

export const num = (n: number) => (numbers ??= new Intl.NumberFormat(intlLocale())).format(n);

function lookup(d: unknown, key: string): unknown {
  let v = d;
  for (const part of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
  return v;
}

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    return v === undefined ? m : typeof v === 'number' ? num(v) : v;
  });
}

export function t(key: Key, vars?: Vars): string {
  const v = lookup(dict, key) ?? lookup(pt, key);
  return typeof v === 'string' ? fill(v, vars) : key;
}

// Plural pela regra do idioma. Português segue a regra de Portugal (só 1 é singular), que é a que o
// texto de origem usa; categoria que o dicionário não tem cai no "other".
export function tn(key: PluralKey, n: number, vars?: Vars): string {
  const entry = (lookup(dict, key) ?? lookup(pt, key)) as Plural | undefined;
  if (!entry || typeof entry !== 'object') return key;
  const rules = (plural ??= new Intl.PluralRules(current === 'pt' ? 'pt-PT' : intlLocale()));
  const text = entry[rules.select(n) as keyof Plural] ?? entry.other;
  return fill(text, { n, ...vars });
}
