// Barra de espaço no jeito da do Mac: uma barra só, dividida por pasta, com a legenda embaixo. Clicar
// abre as maiores mensagens, de 10 em 10. "Ver tudo" leva para a tela inteira (Storage.tsx).
import { useEffect, useRef, useState } from 'react';
import { shortDate } from '../lib/format';
import { navigate } from '../lib/router';
import type { Session } from '../lib/session';
import { STORAGE_FOLDERS, folderLabel, space, storagePage, type BoxFolder, type StoredItem, type Summary } from '../lib/storage';
import { Icon } from './Icon';
import { t, tn } from '../i18n';
import { rich } from '../i18n/rich';
import '../screens/storage.css';

// Ao voltar da tela inteira, Configurações rola de novo até o espaço.
export const spaceReturn = { pending: false };

export type Hot = BoxFolder | 'free' | null;

export function UsageLine({ summary }: { summary: Summary }) {
  const share = summary.quota ? summary.used / summary.quota : 0;
  const pct = Math.min(100, Math.round(share * 100));
  return (
    <div className="sm-top">
      <p className="sm-total">{rich(t('storage.usedOf', { used: space(summary.used), total: space(summary.quota) }), { s: c => <span>{c}</span> })}</p>
      {share > 0.9
        ? <span className="sm-state st-warn"><Icon name="alert" size={14} />{t('storage.almostFull')}</span>
        : pct >= 1 && <span className="sm-state">{pct}%</span>}
    </div>
  );
}

// A barra e a legenda, em duas peças (a barra pode ir dentro de um botão). Cada pasta ganha pelo menos
// um pedacinho visível; o resto é o espaço livre. Na tela inteira, cada pasta da legenda filtra a lista
// (picked): a barra destaca aquele pedaço e apaga os outros.
type MeterProps = { summary: Summary; hot: Hot; onHot: (h: Hot) => void; picked?: BoxFolder | null };

function partsOf(summary: Summary) {
  const parts = STORAGE_FOLDERS
    .map(f => ({ ...f, label: folderLabel(f.id), bytes: summary.folders[f.id]?.bytes ?? 0, count: summary.folders[f.id]?.count ?? 0 }))
    .filter(p => p.bytes > 0);
  return { parts, free: Math.max(0, summary.quota - summary.used) };
}
// O que está sob o mouse manda; sem mouse, manda o filtro.
const dimmed = (hot: Hot, picked: BoxFolder | null | undefined, id: Hot) => {
  const focus = hot ?? picked;
  return focus && focus !== id ? ' is-dim' : '';
};

export function MeterBar({ summary, hot, onHot, picked, large }: MeterProps & { large?: boolean }) {
  const { parts, free } = partsOf(summary);
  const grow = (bytes: number) => (summary.quota ? (bytes / summary.quota) * 1000 : 0);
  const label = [...parts.map(p => t('common.labelValue', { label: p.label, value: space(p.bytes) })), t('common.labelValue', { label: t('storage.free'), value: space(free) })].join(', ');
  return (
    <span className={`sm-bar${large ? ' is-large' : ''}`} role="img" aria-label={label} onMouseLeave={() => onHot(null)}>
      {parts.map(p => (
        <i key={p.id} className={`sm-seg sm-${p.id}${dimmed(hot, picked, p.id)}`} style={{ flexGrow: grow(p.bytes) }}
          title={tn('storage.segTitle', p.count, { label: p.label, size: space(p.bytes) })} onMouseEnter={() => onHot(p.id)} />
      ))}
      {free > 0 && <i className={`sm-free${dimmed(hot, picked, 'free')}`} style={{ flexGrow: grow(free) }} title={t('common.labelValue', { label: t('storage.free'), value: space(free) })} onMouseEnter={() => onHot('free')} />}
    </span>
  );
}

export function MeterLegend({ summary, hot, onHot, picked, onPick }: MeterProps & { onPick?: (f: BoxFolder) => void }) {
  const { parts, free } = partsOf(summary);
  return (
    <ul className={`sm-legend${onPick ? ' is-picker' : ''}`} onMouseLeave={() => onHot(null)}>
      {parts.map(p => {
        const content = <><i className={`sm-dot sm-${p.id}`} />{p.label}<span>{space(p.bytes)}</span></>;
        return (
          <li key={p.id} className={dimmed(hot, picked, p.id)} onMouseEnter={() => onHot(p.id)}>
            {onPick ? (
              <button type="button" className={`sm-pick${picked === p.id ? ' is-on' : ''}`} aria-pressed={picked === p.id} onClick={() => onPick(p.id)}
                title={picked === p.id ? t('storage.showAllFolders') : t('storage.showOnly', { folder: p.label })}>
                {content}{picked === p.id && <Icon name="x" size={12} className="sm-pick-x" />}
              </button>
            ) : content}
          </li>
        );
      })}
      <li className={dimmed(hot, picked, 'free')} onMouseEnter={() => onHot('free')}><i className="sm-dot sm-free-dot" />{t('storage.free')}<span>{space(free)}</span></li>
    </ul>
  );
}

// Uma mensagem na lista. No painel largo da tela inteira, pasta e data viram colunas (storage.css).
export function ItemLine({ item }: { item: StoredItem }) {
  const folder = folderLabel(item.folder);
  const when = shortDate(item.date);
  return (
    <>
      <i className={`sm-dot sm-${item.folder}`} aria-hidden="true" />
      <span className="sb-item-text">
        <strong className={item.head ? undefined : 'is-muted'} dir="auto">{item.head ? item.subject || t('common.noSubject') : t('storage.unopened')}</strong>
        <span><bdi>{item.who}</bdi><span className="sb-inline"> · {folder} · {when}</span></span>
      </span>
      <span className="sb-col sb-col-folder"><i className={`sm-dot sm-${item.folder}`} aria-hidden="true" />{folder}</span>
      <span className="sb-col sb-col-date">{when}</span>
      {item.attachments > 0 && <Icon name="clip" size={14} className="sb-clip" />}
      <span className="sb-size">{space(item.size)}</span>
    </>
  );
}

export function StorageBar({ session, onSeeAll }: { session: Session; onSeeAll: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StoredItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState<Hot>(null);
  const root = useRef<HTMLDivElement>(null);

  // Resumo e as 10 maiores num pedido só. Os nomes abrem aqui, com a chave do aparelho.
  useEffect(() => {
    storagePage(session.secretKey, { sort: 'size', limit: 10 })
      .then(p => { setItems(p.items); setNext(p.next); if (p.summary) setSummary(p.summary); })
      .catch(e => setError(e instanceof Error ? e.message : t('storage.seeFail')));
  }, [session.secretKey]);

  // Voltando da tela inteira: as seções de cima ainda crescem (segurança, aparelhos), então o espaço
  // fica à vista por um instante, até a pessoa rolar.
  useEffect(() => {
    if (!spaceReturn.pending || !summary) return;
    spaceReturn.pending = false;
    const page = root.current?.closest('.st-page');
    const scroller = root.current?.closest('.st-scroll');
    if (!page || !scroller) return;
    // O espaço é a última seção: basta descer até o fim (scrollIntoView mexeria também no painel).
    const stick = () => { scroller.scrollTop = scroller.scrollHeight; };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(page);
    const stop = () => ro.disconnect();
    const t = window.setTimeout(stop, 1500);
    scroller.addEventListener('wheel', stop, { once: true });
    scroller.addEventListener('touchstart', stop, { once: true });
    return () => { window.clearTimeout(t); stop(); scroller.removeEventListener('wheel', stop); scroller.removeEventListener('touchstart', stop); };
  }, [summary]);

  async function more() {
    if (!next || busy) return;
    setBusy(true);
    try {
      const p = await storagePage(session.secretKey, { sort: 'size', after: next, limit: 10 });
      setItems(prev => [...prev, ...p.items]);
      setNext(p.next);
    } catch (e) { setError(e instanceof Error ? e.message : t('storage.loadMoreFail')); }
    setBusy(false);
  }

  if (!summary) {
    return (
      <div className="sb" ref={root}>
        {error ? <p className="st-error">{error}</p> : <div className="sm-skeleton" aria-hidden="true"><i /><i /><i /></div>}
      </div>
    );
  }

  const empty = !items.length;
  return (
    <div className="sb" ref={root}>
      <UsageLine summary={summary} />
      <button className="sb-bar" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="sb-list" disabled={empty}
        aria-label={t(open ? 'storage.hideBiggest' : 'storage.seeBiggest')}>
        <MeterBar summary={summary} hot={hot} onHot={setHot} />
      </button>
      <MeterLegend summary={summary} hot={hot} onHot={setHot} />
      <p className="sb-note">{t('storage.serverKnows')}</p>
      <div className="sb-actions">
        {!empty && (
          <button className="st-btn sb-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="sb-list">
            {t(open ? 'common.hide' : 'storage.biggest')}<Icon name="back" size={14} className={`sb-chev${open ? ' is-open' : ''}`} />
          </button>
        )}
        <button className="st-btn" onClick={() => { spaceReturn.pending = false; onSeeAll(); }}>{t('storage.seeAll')}<Icon name="arrow" size={14} /></button>
      </div>
      {open && (
        <div id="sb-list" className="sb-list">
          <ol>
            {/* Cada linha abre o e-mail, na pasta onde ele está. */}
            {items.map(i => {
              const open = () => navigate(`/caixa/${i.folder}/${i.id}`);
              return (
                <li key={i.id} className="sb-item is-link" role="button" tabIndex={0} onClick={open}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
                  <ItemLine item={i} />
                </li>
              );
            })}
          </ol>
          {next && (
            <button className="st-more" onClick={more} disabled={busy}>
              {busy ? <><span className="spinner" />{t('common.loading')}</> : t('storage.more10')}
            </button>
          )}
          {error && <p className="st-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
