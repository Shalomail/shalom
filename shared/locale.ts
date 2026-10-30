// Idioma da página inicial: a escolha guardada no cookie vence; senão, o primeiro idioma do navegador
// que o site tem; senão, inglês. Sem cabeçalho nenhum (robô de busca), português.
import { LOCALES } from './locales.gen';

export function pickLocale(acceptLanguage: string | null, cookie: string | null): string {
  const saved = /(?:^|;\s*)shalom-lang=([a-z]{2})/.exec(cookie || '')?.[1];
  if (saved && LOCALES.includes(saved)) return saved;
  if (!acceptLanguage) return 'pt';
  const prefs = acceptLanguage.split(',')
    .map(part => {
      const [tag, q] = part.trim().split(';q=');
      return { lang: tag.toLowerCase().split('-')[0].replace(/^iw$/, 'he'), q: q ? Number(q) : 1 };
    })
    .filter(p => p.lang && p.lang !== '*' && p.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) if (LOCALES.includes(p.lang)) return p.lang;
  return 'en';
}
