// Desafio anti-robô da Cloudflare. Carrega o script só quando a tela precisa.
import { useEffect, useRef } from 'react';
import { locale } from '../i18n';

// Idioma do desafio no formato que a Cloudflare aceita.
const LANG: Record<string, string> = { pt: 'pt-br', zh: 'zh-cn', ar: 'ar-eg' };

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return loading;
}

export function Turnstile({ siteKey, onToken, resetKey = 0 }: { siteKey: string; onToken: (t: string | null) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let id: string | null = null;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: siteKey,
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        language: LANG[locale()] ?? locale(),
        size: 'flexible',
        appearance: 'interaction-only',
        callback: (t: string) => cb.current(t),
        'expired-callback': () => cb.current(null),
        'error-callback': () => cb.current(null),
      });
    }).catch(() => cb.current(null));
    return () => {
      gone = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, resetKey]);

  return <div ref={box} className="turnstile" />;
}
