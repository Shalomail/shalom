// Linha que arrasta para o lado, como no app de e-mail do celular.
// Para a esquerda: aparecem as ações da direita (arquivar e apagar); até o fim, arquiva direto.
// Para a direita: aparece "Fixar"; até o fim, fixa direto. Arrasto vertical continua rolando a lista.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type SwipeAction = { label: string; icon: IconName; tone?: 'danger' | 'neutral' | 'accent'; run: () => void };

const OPEN_LEFT = 168;   // largura das duas ações da direita
const OPEN_RIGHT = 92;   // largura da ação da esquerda
const SLOP = 8;

export function SwipeRow({ children, left, right }: { children: ReactNode; left: SwipeAction; right: [SwipeAction, SwipeAction] }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const g = useRef({ id: -1, x: 0, y: 0, base: 0, axis: '' as '' | 'x' | 'y', moved: false });

  // Clique fora fecha a linha aberta.
  useEffect(() => {
    if (dx === 0 || dragging) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setDx(0); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [dx, dragging]);

  function down(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: dx, axis: '', moved: false };
  }

  function move(e: React.PointerEvent) {
    const s = g.current;
    if (s.id !== e.pointerId) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(mx) > SLOP && Math.abs(mx) > Math.abs(my)) {
        s.axis = 'x';
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
      } else if (Math.abs(my) > SLOP) {
        s.axis = 'y';
      }
      return;
    }
    if (s.axis !== 'x') return;
    s.moved = true;
    const width = box.current?.offsetWidth ?? 360;
    let next = s.base + mx;
    // Passou do fim: resistência elástica.
    const max = width * 0.9;
    if (next > max) next = max + (next - max) * 0.2;
    if (next < -max) next = -max + (next + max) * 0.2;
    setDx(next);
  }

  function up(e: React.PointerEvent) {
    const s = g.current;
    if (s.id !== e.pointerId) return;
    g.current.id = -1;
    if (s.axis !== 'x') return;
    setDragging(false);
    const width = box.current?.offsetWidth ?? 360;
    const full = width * 0.55;
    if (dx <= -full) { setDx(-width); setTimeout(() => { right[0].run(); setDx(0); }, 160); return; }
    if (dx >= full) { setDx(0); left.run(); return; }
    if (dx < -56) { setDx(-OPEN_LEFT); return; }
    if (dx > 56) { setDx(OPEN_RIGHT); return; }
    setDx(0);
  }

  // O clique que vem junto com o fim do arrasto só é engolido (a linha fica aberta). Um clique
  // de verdade numa linha aberta fecha ela, sem abrir a mensagem.
  function clickCapture(e: React.MouseEvent) {
    if (g.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      g.current.moved = false;
      return;
    }
    if (dx !== 0) {
      e.preventDefault();
      e.stopPropagation();
      setDx(0);
    }
  }

  const act = (a: SwipeAction) => () => { setDx(0); a.run(); };
  const width = box.current?.offsetWidth ?? 360;
  const pastFullLeft = dx <= -width * 0.55;
  const pastFullRight = dx >= width * 0.55;

  return (
    <div className={`swipe ${dragging ? 'is-dragging' : ''} ${dx !== 0 ? 'is-open' : ''}`} ref={box}>
      {/* Só o lado que está aparecendo recebe clique; o outro, invisível, não pode ficar por cima. */}
      <div className={`swipe-under swipe-under-left ${dx > 0 ? 'is-shown' : ''}`}>
        <button className={`swipe-btn tone-${left.tone ?? 'accent'} ${pastFullRight ? 'is-full' : ''}`} onClick={act(left)} tabIndex={dx > 0 ? 0 : -1}>
          <Icon name={left.icon} size={18} /><span>{left.label}</span>
        </button>
      </div>
      <div className={`swipe-under swipe-under-right ${dx < 0 ? 'is-shown' : ''}`}>
        {right.map((a, i) => (
          <button key={a.label} className={`swipe-btn tone-${a.tone ?? 'neutral'} ${i === 0 && pastFullLeft ? 'is-full' : ''}`} onClick={act(a)} tabIndex={dx < 0 ? 0 : -1}>
            <Icon name={a.icon} size={18} /><span>{a.label}</span>
          </button>
        ))}
      </div>
      <div className="swipe-top" style={{ transform: `translate3d(${dx}px, 0, 0)` }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={clickCapture}>
        {children}
      </div>
    </div>
  );
}
