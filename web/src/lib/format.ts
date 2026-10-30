import type { Person } from '../../../shared/head';
import { intlLocale, locale, num, t } from '../i18n';

// Formatadores no idioma do app, criados uma vez por idioma e opção.
const cache = new Map<string, Intl.DateTimeFormat>();
function dateFmt(opts: Intl.DateTimeFormatOptions) {
  const key = `${intlLocale()}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) cache.set(key, (f = new Intl.DateTimeFormat(intlLocale(), opts)));
  return f;
}
// Português com hora de dois dígitos ("08:05"), como sempre foi; nos outros, o jeito de cada idioma.
const timeOpts = (): Intl.DateTimeFormatOptions => (locale() === 'pt' ? { hour: '2-digit', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' });
// "29 de out." vira "29 de out" só em português; em alemão o ponto do dia é parte da data.
const noDot = (s: string) => (locale() === 'pt' ? s.replace(/\./g, '') : s);

export const timeOf = (d: Date) => dateFmt(timeOpts()).format(d);
export const dayMonth = (d: Date) => noDot(dateFmt({ day: 'numeric', month: 'short' }).format(d));
export const dayMonthYear = (d: Date) => noDot(dateFmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(d));

export function shortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOf(d);
  if (d.getFullYear() === now.getFullYear()) return dayMonth(d);
  return dateFmt({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

// Data no leitor: "Hoje, 22:32", "29 de out, 22:32", "29 de out de 2025, 22:32".
export function readerDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t('date.today', { time: timeOf(d) });
  const year = d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const };
  return noDot(dateFmt({ day: 'numeric', month: 'short', ...year, ...timeOpts() }).format(d));
}

export const fullDate = (iso: string) => dateFmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...timeOpts() }).format(new Date(iso));
export const shortDateTime = (d: Date) => dateFmt({ dateStyle: 'short', timeStyle: 'short' }).format(d);
export const longDay = (d: Date) => dateFmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(d);

// "5 minutos", "1 hora", "7 dias": até 24 horas fala em horas, como na lista de sair por inatividade.
export function durationLabel(minutes: number): string {
  const [value, unit] = minutes < 60 || minutes % 60 ? [minutes, 'minute']
    : minutes <= 1440 || minutes % 1440 ? [minutes / 60, 'hour'] : [minutes / 1440, 'day'];
  return new Intl.NumberFormat(intlLocale(), { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}
export const secondsLabel = (seconds: number) =>
  new Intl.NumberFormat(intlLocale(), { style: 'unit', unit: 'second', unitDisplay: 'long', maximumFractionDigits: 1 }).format(seconds);

export function displayName(p: Person | null | undefined): string {
  if (!p) return t('common.noSender');
  return p.name || p.address.split('@')[0];
}

export function initials(p: Person | null | undefined): string {
  const n = displayName(p).replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// "47,5 MB", "1 GB" (sem ",0"), com a vírgula e a unidade de cada idioma ("47,5 Mo", "1 ГБ").
export function size(bytes: number): string {
  const one = (n: number) => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(Math.round(n * 10) / 10);
  if (bytes < 1024) return `${num(bytes)} ${t('units.b')}`;
  if (bytes < 1024 * 1024) return `${num(Math.round(bytes / 1024))} ${t('units.kb')}`;
  if (bytes < 1024 * 1024 * 1024) return `${one(bytes / 1024 / 1024)} ${t('units.mb')}`;
  return `${one(bytes / 1024 / 1024 / 1024)} ${t('units.gb')}`;
}

// Direção do texto pela primeira letra (o que o dir="auto" faz, mas sem pular o que está dentro de
// <bdi>): hebraico, árabe e vizinhos são da direita para a esquerda; o resto, da esquerda para a direita.
export function textDir(s: string): 'rtl' | 'ltr' {
  const first = s.match(/\p{L}/u)?.[0] ?? '';
  return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(first) ? 'rtl' : 'ltr';
}
