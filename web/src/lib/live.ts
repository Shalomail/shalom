// Caixa ao vivo: um WebSocket com a caixa no servidor (worker/box.ts) avisa quando chega ou muda algo,
// e quem chamou busca a lista de novo. O aviso não traz conteúdo. Se a conexão cair, tenta de novo com
// espera crescente (até 30 s); ao voltar para a aba, reconecta na hora. A atualização a cada minuto do
// Mailbox continua como reserva.
import { currentSlot } from './api';

export type LiveNote = { t: 'new' | 'changed'; folder?: string };

// A conexão ao vivo está aberta agora? Com ela, a busca de reserva da caixa pode ficar bem mais rara.
let connected = false;
export const liveOpen = () => connected;

export function watchMailbox(onNote: (n: LiveNote) => void, onReconnect: () => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let wait = 1000;
  let retry = 0;
  let ping = 0;

  const open = () => {
    if (stopped || (ws && ws.readyState <= WebSocket.OPEN)) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live?slot=${currentSlot()}`;
    const sock = new WebSocket(url);
    ws = sock;
    let reopened = false;
    let heard = Date.now();
    // Caiu (ou foi dado como morto): tenta de novo com espera crescente.
    const lost = () => {
      connected = false;
      window.clearInterval(ping);
      if (stopped) return;
      retry = window.setTimeout(open, wait);
      wait = Math.min(wait * 2, 30_000);
    };
    sock.onopen = () => {
      connected = true;
      heard = Date.now();
      // Depois de uma queda, pode ter chegado algo enquanto estava fora: busca uma vez.
      if (wait > 1000) reopened = true;
      wait = 1000;
      if (reopened) onReconnect();
      window.clearInterval(ping);
      ping = window.setInterval(() => {
        if (sock.readyState !== WebSocket.OPEN) return;
        // Dois pings sem resposta: a conexão morreu sem avisar (troca de Wi-Fi, Mac que dormiu). Sem isto,
        // a aba seguia achando que estava ao vivo e só buscava a cada 5 minutos.
        if (Date.now() - heard > 60_000) {
          sock.onclose = null;
          sock.close();
          if (ws === sock) ws = null;
          wait = Math.max(wait, 2000);
          lost();
          return;
        }
        sock.send('ping');
      }, 25_000);
    };
    sock.onmessage = e => {
      heard = Date.now();
      if (e.data === 'pong') return;
      try { onNote(JSON.parse(e.data)); } catch { /* aviso estranho: ignora */ }
    };
    sock.onclose = lost;
  };

  const back = () => {
    if (document.visibilityState !== 'visible') return;
    if (!ws || ws.readyState === WebSocket.CLOSED) { window.clearTimeout(retry); wait = 2000; open(); }
  };

  open();
  document.addEventListener('visibilitychange', back);
  return () => {
    stopped = true;
    connected = false;
    window.clearTimeout(retry);
    window.clearInterval(ping);
    document.removeEventListener('visibilitychange', back);
    ws?.close();
  };
}
