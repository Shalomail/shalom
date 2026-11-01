// Ícones desenhados para o Shalom: traço de 1,7 px, pontas redondas, grade de 24.
const P: Record<string, string[]> = {
  inbox: ['M3 13h5l1.5 2.5h5L16 13h5', 'M5.2 5h13.6L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.2-8z'],
  star: ['M12 3.6l2.6 5.2 5.8.9-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.9L12 3.6z'],
  send: ['M20.5 3.5L10 14', 'M20.5 3.5l-6.5 17-4-6.5-6.5-4 17-6.5z'],
  archive: ['M3.5 5h17v4h-17z', 'M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9', 'M10 13h4'],
  trash: ['M4 7h16', 'M9.5 7V4.5h5V7', 'M6.5 7l.9 12.1a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7'],
  pen: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  search: ['M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'M20 20l-4.4-4.4'],
  lock: ['M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  shield: ['M12 3l7 3v5.2c0 4.4-3 8.2-7 9.8-4-1.6-7-5.4-7-9.8V6l7-3z', 'M9 12l2.2 2.2L15.5 10'],
  clip: ['M19.5 11.5l-7.9 7.9a5 5 0 0 1-7.1-7.1l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6'],
  reply: ['M9 7l-5 5 5 5', 'M4 12h10.5a5.5 5.5 0 0 1 5.5 5.5v.5'],
  replyAll: ['M12 7l-5 5 5 5', 'M7.5 7l-5 5 5 5', 'M7 12h7.5a5.5 5.5 0 0 1 5.5 5.5v.5'],
  forward: ['M15 7l5 5-5 5', 'M20 12H9.5A5.5 5.5 0 0 0 4 17.5v.5'],
  back: ['M15 5l-7 7 7 7'],
  unread: ['M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'M3.5 7.5l8.5 6 8.5-6'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'],
  eyeOff: ['M3.5 3.5l17 17', 'M10.4 5.6c.5-.1 1-.1 1.6-.1 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8', 'M6.6 6.7C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  user: ['M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5'],
  at: ['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2'],
  x: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h10'],
  logout: ['M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5', 'M9.5 8l-4 4 4 4', 'M5.5 12H15'],
  image: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M9 8.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z', 'M21 15.5l-5-5L7.5 19'],
  alert: ['M12 3.5l9 16h-18l9-16z', 'M12 10v4', 'M12 17v.01'],
  sun: ['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M12 2.5v2', 'M12 19.5v2', 'M4.6 4.6L6 6', 'M18 18l1.4 1.4', 'M2.5 12h2', 'M19.5 12h2', 'M4.6 19.4L6 18', 'M18 6l1.4-1.4'],
  moon: ['M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  undo: ['M9 14l-5-5 5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  download: ['M12 4v11', 'M7.5 10.5L12 15l4.5-4.5', 'M5 20h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  // Escudo com um X, como o xmark.shield do app de iOS.
  spam: ['M12 3l7 3v5.2c0 4.4-3 8.2-7 9.8-4-1.6-7-5.4-7-9.8V6l7-3z', 'M9.6 9.4l4.8 4.8', 'M14.4 9.4l-4.8 4.8'],
  pin: ['M9.5 3.5h5l-.8 5.2 3.3 3.3v1.8H7v-1.8l3.3-3.3-.8-5.2z', 'M12 13.8V20.5'],
  updown: ['M8 9.5l4-4 4 4', 'M8 14.5l4 4 4-4'],
  settings: ['M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z', 'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.4 7.4 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.4A7.4 7.4 0 0 0 6.9 6.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.4 7.4 0 0 0 2.6 1.5l.5 2.4h4l.5-2.4a7.4 7.4 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5z'],
  plus: ['M12 5v14', 'M5 12h14'],
  device: ['M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5z', 'M11 17.5h2'],
  // Envelope aberto: marcar como lida.
  read: ['M3.5 10L12 4.5l8.5 5.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V10z', 'M3.5 10.5l8.5 5.5 8.5-5.5'],
  // Lista em linha (uma conversa por linha) e lista com a leitura ao lado.
  rows: ['M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z', 'M3 9.5h18', 'M3 14.5h18'],
  columns: ['M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z', 'M9.5 4.5v15'],
};

export type IconName = keyof typeof P;

// Ícones que apontam para um lado: em hebraico e árabe (página da direita para a esquerda) viram no espelho.
const DIRECTIONAL = new Set<IconName>(['back', 'arrow', 'reply', 'replyAll', 'forward', 'undo', 'send', 'logout', 'menu', 'columns']);

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={DIRECTIONAL.has(name) ? `ico-dir${className ? ` ${className}` : ''}` : className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// Marca do Shalom Mail: o avião de papel saindo do envelope (desenho do Thomaz, vetorizado em 29/10).
// Cor herdada do texto: branca no tema escuro, preta no claro. Arquivos da marca em brand/.
const MARK = 'M0 0H414V306H0Z M28 28V263.5L160.5 159.5L168.5 189L54 278H386V57.5L281.5 244L244.5 188L208 234.5L182 142.5L97 93.5L311 28Z M204.5 122.5L214 150L336 54Z';

export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 306 / 414)} viewBox="0 0 414 306" aria-hidden="true" className="mark">
      <path fill="currentColor" fillRule="evenodd" d={MARK} />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <Mark />
      <span>Shalom <span className="logo-mail">Mail</span></span>
    </span>
  );
}
