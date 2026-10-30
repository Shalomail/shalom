// Enquadramento da foto de perfil antes de subir: arrastar move, rodinha, pinça ou a régua aproximam.
// O círculo mostra exatamente o que vira foto. O recorte acontece aqui no aparelho.
import { useEffect, useRef, useState } from 'react';
import { cropAvatar } from '../lib/profile';
import { Icon } from './Icon';
import { t } from '../i18n';
import './photo-crop.css';

const VIEW = 280;     // lado da área de recorte, em px de tela
const MAX_ZOOM = 4;

export function PhotoCrop({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (blob: Blob) => Promise<void> }) {
  const [img, setImg] = useState<{ bitmap: ImageBitmap; url: string } | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let url = '';
    createImageBitmap(file)
      .then(bitmap => { url = URL.createObjectURL(file); setImg({ bitmap, url }); })
      .catch(() => setError(t('crop.openFail')));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Escala que faz o lado menor da foto cobrir o círculo; o zoom multiplica a partir dela.
  const base = img ? VIEW / Math.min(img.bitmap.width, img.bitmap.height) : 1;
  const w = img ? img.bitmap.width * base * zoom : 0;
  const h = img ? img.bitmap.height * base * zoom : 0;
  // A foto sempre cobre a área toda: o deslocamento para na borda.
  const clamp = (p: { x: number; y: number }, z = zoom) => {
    if (!img) return p;
    const mx = (img.bitmap.width * base * z - VIEW) / 2;
    const my = (img.bitmap.height * base * z - VIEW) / 2;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  };
  const zoomTo = (z: number) => {
    const next = Math.max(1, Math.min(MAX_ZOOM, z));
    setZoom(next);
    setPos(p => clamp(p, next));
  };

  function down(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function move(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      zoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist));
      return;
    }
    setPos(p => clamp({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }));
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }
  function key(e: React.KeyboardEvent) {
    const step = 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { e.preventDefault(); setPos(p => clamp({ x: p.x + moves[e.key][0], y: p.y + moves[e.key][1] })); }
    else if (e.key === '+' || e.key === '=') zoomTo(zoom + 0.1);
    else if (e.key === '-') zoomTo(zoom - 0.1);
  }

  async function save() {
    if (!img || busy) return;
    setBusy(true);
    setError('');
    // Do círculo na tela para o retângulo na foto original.
    const scale = base * zoom;
    const size = VIEW / scale;
    const cx = img.bitmap.width / 2 - pos.x / scale;
    const cy = img.bitmap.height / 2 - pos.y / scale;
    try {
      await onSave(await cropAvatar(img.bitmap, { x: cx - size / 2, y: cy - size / 2, size }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('err.photo_save'));
      setBusy(false);
    }
  }

  return (
    <div className="crop-scrim" onPointerDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="crop" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <h2 id="crop-title">{t('crop.title')}</h2>
        <p className="crop-hint">{t('crop.hint')}</p>
        <div className="crop-stage" style={{ width: VIEW, height: VIEW }} tabIndex={0} aria-label={t('crop.area')}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
          onWheel={e => zoomTo(zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06))}>
          {img && (
            <img src={img.url} alt="" draggable={false}
              style={{ width: w, height: h, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }} />
          )}
          <span className="crop-ring" aria-hidden="true" />
        </div>
        <label className="crop-zoom">
          <Icon name="image" size={14} />
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={e => zoomTo(Number(e.target.value))} aria-label={t('crop.zoom')} />
          <Icon name="image" size={20} />
        </label>
        {error && <p className="crop-error" role="alert">{error}</p>}
        <div className="crop-actions">
          <button ref={cancelRef} className="btn btn-quiet" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={save} disabled={!img || busy}>{busy ? <><span className="spinner" />{t('common.saving')}</> : t('crop.save')}</button>
        </div>
      </div>
    </div>
  );
}
