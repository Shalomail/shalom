// Fundo das telas de entrar e de cadastro: "shalom" (paz) em várias línguas, em fileiras inclinadas,
// quase da cor do fundo. Só enfeite: fica atrás de tudo e não recebe clique nem leitor de tela. Como toda
// tela de entrada tem este fundo, é ele que deixa a página no claro enquanto ela está aberta.
import { useAuthTheme } from '../lib/theme';

const WORDS = ['שָׁלוֹם', 'Shalom', 'سلام', 'Paz', 'Peace', 'Paix', 'Frieden', 'Мир', 'Pace', '和平', '平和', '평화', 'शांति', 'Barış', 'Ειρήνη', 'Pokój', 'Amani', 'Rauha', 'Мир', 'Vrede'];

export function PeaceBackdrop() {
  useAuthTheme();
  // Cada fileira começa num ponto diferente da lista, para as palavras não se alinharem em coluna.
  const rows = Array.from({ length: 14 }, (_, r) => {
    const start = (r * 7) % WORDS.length;
    return [...WORDS.slice(start), ...WORDS.slice(0, start), ...WORDS.slice(start), ...WORDS.slice(0, start)];
  });
  return (
    <div className="peace" aria-hidden="true">
      <div className="peace-in">
        {rows.map((words, i) => <p key={i}>{words.map((w, j) => <span key={j}>{w}</span>)}</p>)}
      </div>
    </div>
  );
}
