// Sair sozinho por inatividade. O servidor confere o tempo a cada pedido, mas a caixa aberta se atualiza
// sozinha de tempos em tempos, então quem decide que a pessoa parou é o aparelho.
// O último uso fica no localStorage da conta: mexer em qualquer aba conta para todas.
import { useEffect, useRef } from 'react';
import { currentSlot } from './api';

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const WRITE_EVERY = 10_000;
const CHECK_EVERY = 15_000;

export function useIdleSignOut(minutes: number | null, onIdle: () => void) {
  const callback = useRef(onIdle);
  useEffect(() => { callback.current = onIdle; }, [onIdle]);

  useEffect(() => {
    if (!minutes) return;
    const key = `shalom-active:${currentSlot()}`;
    const limit = minutes * 60_000;
    let last = 0;
    let fired = false;

    const read = () => {
      let shared = 0;
      try { shared = Number(localStorage.getItem(key)) || 0; } catch { /* sem armazenamento: vale esta aba */ }
      return Math.max(last, shared);
    };
    const mark = () => {
      const t = Date.now();
      if (t - last < WRITE_EVERY) return;
      last = t;
      try { localStorage.setItem(key, String(t)); } catch { /* idem */ }
    };
    const check = () => {
      if (fired || Date.now() - read() <= limit) return;
      fired = true;
      callback.current();
    };
    // Voltar para a aba (ou acordar o computador) confere na hora, sem esperar o próximo ciclo.
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };

    // Abrir a caixa conta como uso.
    mark();
    const timer = window.setInterval(check, CHECK_EVERY);
    EVENTS.forEach(e => window.addEventListener(e, mark, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      EVENTS.forEach(e => window.removeEventListener(e, mark, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [minutes]);
}
