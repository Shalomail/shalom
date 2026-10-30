// Ordem das pastas da lateral, escolhida pela pessoa: arrastar (mouse ou dedo) ou Alt + seta. Fica
// guardada neste aparelho, uma por conta. Pasta nova que ainda não estava na ordem salva entra no lugar
// padrão dela.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const key = (userId: string) => `shalom-folder-order:${userId}`;

export function loadOrder<T extends string>(userId: string, defaults: T[]): T[] {
  let saved: string[] = [];
  try { saved = JSON.parse(localStorage.getItem(key(userId)) || '[]'); } catch { /* ordem padrão */ }
  const known = saved.filter((id): id is T => defaults.includes(id as T));
  for (const id of defaults) {
    if (known.includes(id)) continue;
    const at = defaults.indexOf(id);
    const before = defaults.slice(0, at).reverse().find(d => known.includes(d));
    known.splice(before ? known.indexOf(before) + 1 : 0, 0, id);
  }
  return known;
}

export function saveOrder(userId: string, ids: string[]) {
  try { localStorage.setItem(key(userId), JSON.stringify(ids)); } catch { /* sem armazenamento: vale só agora */ }
}

const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
};

// Arrastar para reordenar uma lista vertical. No mouse, começa depois de mexer 5 px; no dedo, depois
// de segurar 250 ms parado (mexer antes disso é rolagem). O clique que termina um arraste não navega.
export function useSortable<T extends string>(ids: T[], onChange: (ids: T[]) => void, onDone: (ids: T[]) => void) {
  const [dragging, setDragging] = useState<T | null>(null);
  const live = useRef(ids);
  live.current = ids;
  const drag = useRef<{ id: T; x: number; y: number; touch: boolean; on: boolean; timer: number; el: HTMLElement; pointer: number } | null>(null);
  const swallowClick = useRef(false);

  const activate = () => {
    const d = drag.current;
    if (!d) return;
    d.on = true;
    setDragging(d.id);
    try { d.el.setPointerCapture(d.pointer); } catch { /* sem captura: segue pelo movimento */ }
  };

  function end() {
    const d = drag.current;
    if (!d) return;
    window.clearTimeout(d.timer);
    if (d.on) {
      swallowClick.current = true;
      window.setTimeout(() => { swallowClick.current = false; }, 0);
      onDone(live.current);
    }
    drag.current = null;
    setDragging(null);
  }

  const handlers = (id: T) => ({
    draggable: false,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const touch = e.pointerType !== 'mouse';
      drag.current = { id, x: e.clientX, y: e.clientY, touch, on: false, timer: 0, el: e.currentTarget, pointer: e.pointerId };
      if (touch) drag.current.timer = window.setTimeout(activate, 250);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (!d.on) {
        if (d.touch) { if (dist > 8) { window.clearTimeout(d.timer); drag.current = null; } return; }
        if (dist > 5) activate(); else return;
      }
      e.preventDefault();
      const list = d.el.parentElement;
      if (!list) return;
      const items = Array.from(list.children) as HTMLElement[];
      const from = live.current.indexOf(d.id);
      let to = items.findIndex(el => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (to === -1) to = items.length - 1;
      else if (to > from) to -= 1;
      if (to !== from && to >= 0) onChange(move(live.current, from, to));
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (swallowClick.current) { e.preventDefault(); e.stopPropagation(); }
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const from = live.current.indexOf(id);
      const to = Math.min(live.current.length - 1, Math.max(0, from + (e.key === 'ArrowUp' ? -1 : 1)));
      if (to === from) return;
      const next = move(live.current, from, to);
      onChange(next);
      onDone(next);
    },
  });

  return { dragging, handlers };
}
