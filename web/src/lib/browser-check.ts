// Checagem do navegador antes de abrir a caixa: procura sinais de que alguém está lendo a página junto
// com a pessoa. Pega o que dá para ver de dentro da página (funções do navegador trocadas, código e
// quadros colocados por fora, automação, página dentro de outra, conexão sem segurança). Não pega
// programa instalado no computador, que vê a tela inteira; a tela diz isso com todas as letras.

import { t } from '../i18n';

export type CheckId = 'secure' | 'framed' | 'automation' | 'native' | 'injected';
export const CHECKS: CheckId[] = ['secure', 'framed', 'automation', 'native', 'injected'];

// Tudo o que aparece vai no mesmo aviso. Extensão vem com nome, o que ela faz e o sinal que deixou na
// página, para a pessoa saber o que estava rodando ali. "keys" identifica cada coisa encontrada, para a
// pessoa poder confiar nela neste aparelho.
export type Entry = { key: string; name: string; note: string; mark: string };
export type Finding = { id: CheckId | 'extensions'; items: string[]; entries?: Entry[]; keys: string[]; trustable: boolean };

const TRUST_KEY = 'shalom-browser-trust';
// Domínios de fora que são do próprio Shalom: o anti-robô da Cloudflare (entrada e cadastro) e o
// contador de visitas que a Cloudflare injeta e a política de segurança bloqueia.
const TRUSTED_HOSTS = new Set(['challenges.cloudflare.com', 'static.cloudflareinsights.com']);
const EXT_PROTOCOL = /^(chrome|moz|safari-web|ms-browser)-extension:$/;
// Extensões conhecidas pelo rastro que deixam na página, com o que cada uma faz (bc.ext.<slug>).
const KNOWN: [RegExp, string, ExtSlug][] = [
  [/grammarly|data-gr-/i, 'Grammarly', 'grammarly'],
  [/darkreader/i, 'Dark Reader', 'darkreader'],
  [/cz-shortcut-listen/i, 'ColorZilla', 'colorzilla'],
  [/languagetool|data-lt-/i, 'LanguageTool', 'languagetool'],
  [/loom/i, 'Loom', 'loom'],
  [/honey/i, 'Honey', 'honey'],
];
type ExtSlug = 'grammarly' | 'darkreader' | 'colorzilla' | 'languagetool' | 'loom' | 'honey';
const HTML_ATTRS = new Set(['lang', 'dir', 'data-theme', 'data-skin', 'style', 'class']);
const BODY_ATTRS = new Set(['class', 'style']);

// Bloqueios da política de segurança desde que a página abriu: tentativa de rodar código de fora.
const blocked = new Set<string>();
document.addEventListener('securitypolicyviolation', e => {
  if (/^script-src|^frame-src|^connect-src|^default-src/.test(e.effectiveDirective)) blocked.add(e.blockedURI || 'inline');
});

export function trusted(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(TRUST_KEY) || '[]')); } catch { return new Set(); }
}

export function trust(keys: string[]) {
  const all = trusted();
  keys.forEach(k => all.add(k));
  try { localStorage.setItem(TRUST_KEY, JSON.stringify([...all])); } catch { /* sem armazenamento */ }
}

function knownExt(text: string) {
  const k = KNOWN.find(([re]) => re.test(text));
  return k ? { name: k[1], slug: k[2] } : null;
}

function hostOf(src: string) {
  try {
    const u = new URL(src, location.href);
    if (EXT_PROTOCOL.test(u.protocol)) return { ext: true, label: 'uma extensão do navegador', key: `ext-url:${u.host}` };
    if (u.origin === location.origin || TRUSTED_HOSTS.has(u.host)) return null;
    return { ext: false, label: u.host, key: `host:${u.host}` };
  } catch { return null; }
}

function checkSecure(): Finding | null {
  const ok = window.isSecureContext && !!crypto?.subtle;
  return ok ? null : { id: 'secure', items: [t('bc.insecure')], keys: ['insecure'], trustable: false };
}

function checkFramed(): Finding | null {
  let framed = false;
  try { framed = window.top !== window.self; } catch { framed = true; }
  return framed ? { id: 'framed', items: [t('bc.inFrame')], keys: ['framed'], trustable: false } : null;
}

function checkAutomation(): Finding | null {
  const w = window as unknown as Record<string, unknown>;
  const signs: string[] = [];
  if (navigator.webdriver) signs.push(t('bc.webdriver'));
  if (Object.keys(document).some(k => /^\$(cdc|wdc)_/.test(k)) || w.domAutomation || w.domAutomationController) signs.push(t('bc.selenium'));
  if (w.callPhantom || w._phantom || w.__nightmare) signs.push(t('bc.automated'));
  if (Object.keys(w).some(k => /^__(playwright|pw)/.test(k))) signs.push(t('bc.playwright'));
  return signs.length ? { id: 'automation', items: signs, keys: ['automation'], trustable: true } : null;
}

// Funções do navegador que um espião troca para ler o que a página decifra ou digita. Cada uma é
// conferida com o toString de uma janela limpa (um quadro vazio criado agora), que um script da página
// não alcança.
function checkNative(): Finding | null {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(frame);
  const clean = (frame.contentWindow as (Window & typeof globalThis) | null)?.Function.prototype.toString;
  const desc = (o: object, k: string) => Object.getOwnPropertyDescriptor(o, k)?.get;
  const targets: [string, () => unknown][] = [
    ['fetch', () => window.fetch],
    ['XMLHttpRequest', () => XMLHttpRequest.prototype.open],
    ['XMLHttpRequest', () => XMLHttpRequest.prototype.send],
    ['WebSocket', () => window.WebSocket],
    ['crypto.getRandomValues', () => crypto.getRandomValues],
    ...(['decrypt', 'encrypt', 'importKey', 'exportKey', 'deriveBits', 'deriveKey', 'unwrapKey', 'wrapKey', 'generateKey', 'sign'] as const)
      .map(k => [`crypto.subtle.${k}`, () => crypto.subtle?.[k]] as [string, () => unknown]),
    ['Function.toString', () => Function.prototype.toString],
    ['addEventListener', () => EventTarget.prototype.addEventListener],
    ['innerHTML', () => desc(Element.prototype, 'innerHTML')],
    ['textContent', () => desc(Node.prototype, 'textContent')],
    ['campos de texto', () => desc(HTMLInputElement.prototype, 'value')],
    ['localStorage', () => localStorage.getItem],
    ['indexedDB', () => indexedDB.open],
    ['postMessage', () => window.postMessage],
    ['TextDecoder', () => TextDecoder.prototype.decode],
  ];
  const changed = new Set<string>();
  if (clean) {
    for (const [name, get] of targets) {
      let fn: unknown;
      try { fn = get(); } catch { continue; }
      if (typeof fn !== 'function') continue;
      let src = '';
      try { src = clean.call(fn); } catch { src = ''; }
      if (!/\{\s*\[native code\]\s*\}\s*$/.test(src)) changed.add(name);
    }
  }
  frame.remove();
  if (!changed.size) return null;
  const names = [...changed];
  return {
    id: 'native',
    // O nome fica igual na chave (confiança salva vale em qualquer idioma); só o que aparece é traduzido.
    items: [t('bc.replaced', { names: names.map(n => (n === 'campos de texto' ? t('bc.textFields') : n)).join(', ') }), t('bc.replacedHint')],
    keys: names.map(n => `native:${n}`),
    trustable: true,
  };
}

// Código e quadros de fora rodando dentro da página, e extensões com acesso a ela (pelo rastro que deixam).
function checkInjected(extra: Set<string>): [Finding | null, Finding | null] {
  const risks = new Map<string, string>();
  const exts = new Map<string, Entry>();
  const risk = (key: string, label: string) => { if (!risks.has(key)) risks.set(key, label); };
  const ext = (key: string, name: string, note: string, mark: string) => { if (!exts.has(key)) exts.set(key, { key, name, note, mark }); };
  const named = (text: string, fallbackKey: string, note: string, mark: string) => {
    const k = knownExt(text);
    if (k) ext(`ext:${k.name}`, k.name, t(`bc.ext.${k.slug}`), mark);
    else ext(fallbackKey, t('bc.extUnknownName'), note, mark);
  };

  for (const s of Array.from(document.scripts)) {
    if (s.src) {
      const h = hostOf(s.src);
      if (h) risk(h.key, h.ext ? t('bc.extScript') : t('bc.hostScript', { host: h.label }));
    } else if (!import.meta.env.DEV && !/json/.test(s.type)) {
      risk('inline-script', t('bc.inlineScript'));
    }
  }
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    if (!f.src || f.src === 'about:blank') continue;
    const h = hostOf(f.src);
    if (h) risk(h.key, h.ext ? t('bc.extFrame') : t('bc.hostFrame', { host: h.label }));
  }
  for (const el of Array.from(document.querySelectorAll('[src], [href]'))) {
    const url = el.getAttribute('src') || el.getAttribute('href') || '';
    if (/^(chrome|moz|safari-web|ms-browser)-extension:/.test(url)) named(url, `ext-res:${el.tagName}`, t('bc.extFile'), url.split('/').slice(0, 3).join('/'));
  }
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (!el.tagName.includes('-')) continue;
    const tag = el.tagName.toLowerCase();
    named(tag, `tag:${tag}`, t('bc.element', { tag }), `<${tag}>`);
  }
  for (const el of Array.from(document.head.children)) {
    if (el.tagName !== 'STYLE' || el.hasAttribute('data-vite-dev-id')) continue;
    named(`${el.id} ${el.className}`, 'style', t('bc.style'), `<style${el.className ? ` class="${el.className}"` : ''}>`);
  }
  const attrs: [Element, Set<string>][] = [[document.documentElement, HTML_ATTRS], [document.body, BODY_ATTRS]];
  for (const [el, allowed] of attrs) {
    for (const a of Array.from(el.attributes)) {
      if (!allowed.has(a.name)) named(a.name, `attr:${a.name}`, t('bc.ext.unknown'), `${a.name} <${el.tagName.toLowerCase()}>`);
    }
  }
  for (const uri of [...blocked, ...extra]) {
    const h = uri === 'inline' ? null : hostOf(uri);
    risk(h ? h.key : 'blocked-inline', h ? (h.ext ? t('bc.blockedExt') : t('bc.blockedHost', { host: h.label })) : t('bc.blockedInline'));
  }
  return [
    risks.size ? { id: 'injected', items: [...new Set(risks.values())], keys: [...risks.keys()], trustable: true } : null,
    exts.size ? { id: 'extensions', items: [], entries: [...exts.values()], keys: [...exts.keys()], trustable: true } : null,
  ];
}

export type Run = { findings: Finding[]; stop: () => Finding[] };

// Começa a vigiar a página (o que chegar enquanto a tela de checagem está aberta também conta) e faz
// as conferências. stop() encerra a vigia e devolve o resultado final.
export function runBrowserCheck(): Run {
  const late = new Set<string>();
  const watch = new MutationObserver(list => {
    for (const m of list) for (const n of Array.from(m.addedNodes)) {
      if (n instanceof HTMLScriptElement && n.src) late.add(n.src);
      if (n instanceof HTMLIFrameElement && n.src) late.add(n.src);
    }
  });
  watch.observe(document.documentElement, { childList: true, subtree: true });
  const known = trusted();
  // O que a pessoa já marcou como confiável neste aparelho sai da lista; extensão por extensão.
  const pass = () => [checkSecure(), checkFramed(), checkAutomation(), checkNative(), ...checkInjected(late)]
    .filter((f): f is Finding => !!f)
    .map(f => (f.entries ? { ...f, entries: f.entries.filter(e => !known.has(e.key)), keys: f.keys.filter(k => !known.has(k)) } : f))
    .filter(f => (f.entries ? f.entries.length > 0 : !f.trustable || f.keys.some(k => !known.has(k))));
  const findings = pass();
  return {
    findings,
    stop: () => { watch.disconnect(); return pass(); },
  };
}
