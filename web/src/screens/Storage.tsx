// Espaço, a tela inteira (dentro de Configurações): a barra por pasta, tudo o que ocupa espaço numa lista
// com colunas ordenáveis, filtro por pasta pela legenda, e apagar de vez o que a pessoa escolher. Apagar
// pede um botão segurado.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { navigate } from '../lib/router';
import type { Session } from '../lib/session';
import {
  countOf, deleteEverything, deleteForeverAnywhere, folderLabel, folderVars, loadEverything, space, STORAGE_FOLDERS, storagePage,
  storageSummary, stripAll, type BoxFolder, type Dir, type StoredItem, type Summary,
} from '../lib/storage';
import { Icon } from '../ui/Icon';
import { intlLocale, t as tr, tn, type Key } from '../i18n';
import { rich } from '../i18n/rich';
import { secondsLabel } from '../lib/format';
import { ItemLine, MeterBar, MeterLegend, UsageLine, spaceReturn, type Hot } from '../ui/StorageBar';
import './settings.css';
import './storage.css';

const PAGE = 100;
type SortBy = 'name' | 'folder' | 'date' | 'size';
type Sort = { by: SortBy; dir: Dir };
// Tamanho e data o servidor entrega em ordem; nome e pasta só dá para ordenar com tudo aberto aqui.
const LOCAL = new Set<SortBy>(['name', 'folder']);
const FIRST_DIR: Record<SortBy, Dir> = { name: 'asc', folder: 'asc', date: 'desc', size: 'desc' };
const COLS: { by: SortBy; label: Key }[] = [
  { by: 'name', label: 'storage.colName' }, { by: 'folder', label: 'storage.colFolder' }, { by: 'date', label: 'storage.colDate' }, { by: 'size', label: 'storage.colSize' },
];
// Curtos de propósito: no celular viram as opções do "Ordenar".
const ORDER_LABEL: Record<SortBy, Record<Dir, Key>> = {
  name: { asc: 'storage.nameAsc', desc: 'storage.nameDesc' },
  folder: { asc: 'storage.folderAsc', desc: 'storage.folderDesc' },
  date: { desc: 'storage.dateDesc', asc: 'storage.dateAsc' },
  size: { desc: 'storage.sizeDesc', asc: 'storage.sizeAsc' },
};
const folderRank = (f: BoxFolder) => STORAGE_FOLDERS.findIndex(x => x.id === f);

// Mesma ordem do servidor (valor, depois id), para a lista não pular quando chega outra página.
function compare({ by, dir }: Sort) {
  const collator = new Intl.Collator(intlLocale(), { sensitivity: 'base', numeric: true });
  return (a: StoredItem, b: StoredItem) => {
    if (by === 'name' && !a.subject !== !b.subject) return a.subject ? -1 : 1;
    let d = by === 'size' ? a.size - b.size
      : by === 'date' ? a.receivedAt - b.receivedAt
      : by === 'folder' ? folderRank(a.folder) - folderRank(b.folder) || b.receivedAt - a.receivedAt
      : collator.compare(a.subject, b.subject) || collator.compare(a.who, b.who);
    if (!d) d = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return dir === 'asc' ? d : -d;
  };
}

const fail = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

type Dialog =
  | { kind: 'selected'; ids: string[]; bytes: number }
  | { kind: 'files'; items: StoredItem[]; bytes: number; locked: number; folder: BoxFolder | null }
  | { kind: 'all'; count: number; bytes: number; at: number; folder: BoxFolder | null };

// Seta da coluna ativa, no traço do Icon: para cima é crescente (A a Z, menores, mais antigas).
function Arrow({ dir }: { dir: Dir }) {
  return (
    <svg className="sp-arrow" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'asc' ? <><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></> : <><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></>}
    </svg>
  );
}

export function Storage({ session, onBack }: { session: Session; onBack: () => void }) {
  const key = session.secretKey;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<StoredItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [sort, setSort] = useState<Sort>({ by: 'size', dir: 'desc' });
  const [filter, setFilter] = useState<BoxFolder | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'more' | 'scan'>('loading');
  const [scan, setScan] = useState({ done: 0, total: 0, why: 'name' as 'name' | 'files' });
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Map<string, StoredItem>>(new Map());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [preparing, setPreparing] = useState<'files' | 'all' | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [hot, setHot] = useState<Hot>(null);
  const token = useRef(0);
  // Até onde a lista carregada vale: todas as pastas (null) ou uma; e se já tem tudo dela.
  const scopeRef = useRef<BoxFolder | null>(null);
  const completeRef = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const noteTimer = useRef(0);

  useEffect(() => () => { token.current++; window.clearTimeout(noteTimer.current); }, []);

  function say(text: string) {
    setNote(text);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(''), 7000);
  }

  function keep(list: StoredItem[], nextCursor: string | null, scope: BoxFolder | null) {
    setItems(list);
    setNext(nextCursor);
    scopeRef.current = scope;
    completeRef.current = !nextCursor;
    setComplete(!nextCursor);
  }

  // A lista carregada já responde por esta pasta (ou por todas) sem ir ao servidor?
  const covers = (f: BoxFolder | null) => completeRef.current && (scopeRef.current === null || scopeRef.current === f);

  // Tudo da pasta (ou da conta) carregado e aberto no aparelho: a partir daí qualquer ordem é local.
  const loadAll = useCallback(async (f: BoxFolder | null, why: 'name' | 'files' = 'name') => {
    const t = ++token.current;
    setState('scan');
    setScan({ done: 0, total: 0, why });
    try {
      const r = await loadEverything(key, f, (done, total) => { if (t === token.current) setScan({ done, total, why }); }, () => t !== token.current);
      if (t !== token.current) return null;
      if (r.summary) setSummary(r.summary);
      keep(r.items, null, f);
      setState('ready');
      return r.items;
    } catch (e) {
      if (t === token.current) { setError(fail(e, tr('storage.loadFail'))); setState('ready'); }
      return null;
    }
  }, [key]);

  // Primeira página na ordem e na pasta pedidas. Tamanho e data vêm prontos do servidor.
  const load = useCallback(async (s: Sort, f: BoxFolder | null, force = false) => {
    setShown(PAGE);
    setError('');
    if (!force && covers(f)) { setState('ready'); return; }
    if (LOCAL.has(s.by)) { await loadAll(f); return; }
    const t = ++token.current;
    setState('loading');
    try {
      const page = await storagePage(key, { sort: s.by as 'size' | 'date', dir: s.dir, limit: PAGE, folder: f });
      if (t !== token.current) return;
      if (page.summary) setSummary(page.summary);
      keep(page.items, page.next, f);
      setState('ready');
    } catch (e) {
      if (t === token.current) { setError(fail(e, tr('storage.loadFail'))); setState('ready'); }
    }
  }, [key, loadAll]);

  useEffect(() => { load({ by: 'size', dir: 'desc' }, null); }, [load]);

  const scoped = useMemo(() => (filter && scopeRef.current === null ? items.filter(i => i.folder === filter) : items), [items, filter]);
  const sorted = useMemo(() => [...scoped].sort(compare(sort)), [scoped, sort]);
  const rows = sorted.slice(0, shown);
  const canMore = shown < sorted.length || (!!next && !complete);

  const more = useCallback(async () => {
    if (state !== 'ready') return;
    if (shown < sorted.length) { setShown(n => n + PAGE); return; }
    if (!next || LOCAL.has(sort.by)) return;
    const t = token.current;
    setState('more');
    try {
      const page = await storagePage(key, { sort: sort.by as 'size' | 'date', dir: sort.dir, after: next, limit: PAGE, folder: scopeRef.current });
      if (t !== token.current) return;
      setItems(prev => [...prev, ...page.items]);
      setNext(page.next);
      completeRef.current = !page.next;
      setComplete(!page.next);
      setShown(n => n + PAGE);
    } catch (e) { if (t === token.current) setError(fail(e, tr('storage.loadMoreFail'))); }
    if (t === token.current) setState('ready');
  }, [state, shown, sorted.length, next, sort, key]);

  // Rolar até o fim carrega a próxima página.
  const moreRef = useRef(more);
  useEffect(() => { moreRef.current = more; }, [more]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) moreRef.current(); }, { root: el.closest('.st-scroll'), rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [state]);

  // Coluna: a mesma inverte a direção; outra começa na direção natural dela.
  function sortBy(by: SortBy) {
    const s: Sort = by === sort.by ? { by, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { by, dir: FIRST_DIR[by] };
    setSort(s);
    load(s, filter);
  }
  function pickOrder(value: string) {
    const [by, dir] = value.split(':') as [SortBy, Dir];
    const s = { by, dir };
    setSort(s);
    load(s, filter);
  }

  // Pasta da legenda: filtra; a mesma de novo volta para todas. A seleção fica só com o que continua à vista.
  function pickFolder(f: BoxFolder) {
    const nextFilter = filter === f ? null : f;
    setFilter(nextFilter);
    if (nextFilter) setSelected(prev => new Map([...prev].filter(([, i]) => i.folder === nextFilter)));
    const s = nextFilter && sort.by === 'folder' ? { by: 'size' as SortBy, dir: 'desc' as Dir } : sort;
    if (s !== sort) setSort(s);
    load(s, nextFilter);
  }

  function toggle(item: StoredItem) {
    setSelected(prev => {
      const m = new Map(prev);
      if (m.has(item.id)) m.delete(item.id); else m.set(item.id, item);
      return m;
    });
  }
  const allShown = rows.length > 0 && rows.every(i => selected.has(i.id));
  const someShown = rows.some(i => selected.has(i.id));
  function toggleShown() {
    setSelected(prev => {
      const m = new Map(prev);
      if (allShown) rows.forEach(i => m.delete(i.id)); else rows.forEach(i => m.set(i.id, i));
      return m;
    });
  }
  const selBytes = useMemo(() => [...selected.values()].reduce((n, i) => n + i.size, 0), [selected]);

  async function refreshSummary() {
    const s = await storageSummary().catch(() => null);
    if (s) setSummary(s);
    return s;
  }

  const totalOf = (s: Summary, f: BoxFolder | null) => (f ? s.folders[f]?.count ?? 0 : countOf(s));
  const bytesOf = (s: Summary, f: BoxFolder | null) => (f ? s.folders[f]?.bytes ?? 0 : s.used);

  async function askAll() {
    setPreparing('all');
    const s = await refreshSummary();
    setPreparing(null);
    if (!s) { setError(tr('storage.checkFail')); return; }
    const count = totalOf(s, filter);
    if (!count) { say(filter ? tr('storage.nothingIn', folderVars(filter)) : tr('storage.alreadyEmpty')); return; }
    setDialog({ kind: 'all', count, bytes: bytesOf(s, filter), at: s.at, folder: filter });
  }

  async function askFiles() {
    setPreparing('files');
    const f = filter;
    const loaded = covers(f) ? items : await loadAll(f, 'files');
    setPreparing(null);
    if (!loaded) return;
    const list = f ? loaded.filter(i => i.folder === f) : loaded;
    const withFiles = list.filter(i => i.attachments > 0 && i.head);
    const open = withFiles.filter(i => !i.locked);
    if (!open.length) {
      say(withFiles.length ? tr('storage.lockedFiles') : f ? tr('storage.noFilesIn', folderVars(f)) : tr('storage.noFiles'));
      return;
    }
    setDialog({ kind: 'files', items: open, bytes: open.reduce((n, i) => n + i.size, 0), locked: withFiles.length - open.length, folder: f });
  }

  // Depois de apagar em massa: resumo novo e a lista de novo do servidor.
  async function reloadAfter() {
    setSelected(new Map());
    completeRef.current = false;
    const s = await refreshSummary();
    load(sort, filter, true);
    return s;
  }

  function back() {
    spaceReturn.pending = true;
    onBack();
  }

  const total = summary ? totalOf(summary, filter) : 0;
  const busy = state === 'loading' || state === 'scan';
  const order = `${sort.by}:${sort.dir}`;
  const orderOptions = (Object.keys(ORDER_LABEL) as SortBy[])
    .filter(by => !(by === 'folder' && filter))
    .flatMap(by => (Object.keys(ORDER_LABEL[by]) as Dir[]).map(dir => ({ value: `${by}:${dir}`, label: tr(ORDER_LABEL[by][dir]) })));
  const countText = summary ? tn('common.messages', total) : tr('storage.messagesTitle');
  const selectAll = (
    <input type="checkbox" className="sp-check" checked={allShown} ref={el => { if (el) el.indeterminate = !allShown && someShown; }}
      onChange={toggleShown} disabled={!rows.length} aria-label={tr('storage.selectList')} />
  );

  return (
    <main className="profile st sp">
      <div className="st-scroll">
        <div className="st-page sp-page">
          <header className="st-top sp-top">
            <button className="icon-btn sp-back" onClick={back} aria-label={tr('storage.back')}><Icon name="back" /></button>
            <h1>{tr('storage.title')}</h1>
          </header>

          <section className="sp-overview" aria-label={tr('storage.overview')}>
            {summary ? (
              <>
                <UsageLine summary={summary} />
                <MeterBar summary={summary} hot={hot} onHot={setHot} picked={filter} large />
                <MeterLegend summary={summary} hot={hot} onHot={setHot} picked={filter} onPick={pickFolder} />
              </>
            ) : <div className="sm-skeleton is-large" aria-hidden="true"><i /><i /><i /></div>}
            <div className="sp-bulk">
              <button className="st-btn st-btn-icon" onClick={askFiles} disabled={!summary || !!preparing || !total}>
                {preparing === 'files' ? <span className="spinner" /> : <Icon name="clip" size={15} />}
                {filter ? tr('storage.deleteFilesIn', folderVars(filter)) : tr('storage.deleteAllFiles')}
              </button>
              <button className="st-btn st-btn-icon" onClick={askAll} disabled={!summary || !!preparing || !total}>
                {preparing === 'all' ? <span className="spinner" /> : <Icon name="trash" size={15} />}
                {filter ? tr('storage.deleteAllIn', folderVars(filter)) : tr('storage.deleteEverything')}
              </button>
            </div>
          </section>

          <section className="sp-list" aria-label={tr('storage.messagesTitle')}>
            <div className="sp-head">
              <div className="sp-line">
                <span className="sp-phone-check">{selectAll}</span>
                {filter ? (
                  <button className="sp-chip" onClick={() => pickFolder(filter)} aria-label={tr('storage.clearFilter', folderVars(filter))}>
                    <i className={`sm-dot sm-${filter}`} />{folderLabel(filter)}<Icon name="x" size={12} />
                  </button>
                ) : null}
                <span className="sp-count">{countText}</span>
                <span className="st-select sp-order">
                  <select value={order} onChange={e => pickOrder(e.target.value)} aria-label={tr('storage.sort')}>
                    {orderOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <Icon name="updown" size={14} />
                </span>
              </div>
              <div className="sp-cols">
                {selectAll}
                {COLS.map(c => {
                  const on = sort.by === c.by;
                  if (c.by === 'folder' && filter) return <span key={c.by} className={`sp-col sp-col-${c.by} is-static`}>{tr(c.label)}</span>;
                  return (
                    <button key={c.by} className={`sp-col sp-col-${c.by}${on ? ' is-on' : ''}`} onClick={() => sortBy(c.by)}
                      aria-label={tr('storage.sortBy', { order: tr(ORDER_LABEL[c.by][on ? (sort.dir === 'desc' ? 'asc' : 'desc') : FIRST_DIR[c.by]]) })}
                      aria-pressed={on}>
                      <span>{tr(c.label)}</span>{on && <Arrow dir={sort.dir} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {note && <p className="st-done sp-note" role="status"><Icon name="check" size={14} />{note}</p>}
            {error && <p className="st-error sp-note">{error}</p>}

            {state === 'scan' ? (
              <div className="sp-scan" role="status">
                <p>
                  {scan.total
                    ? tr(scan.why === 'files' ? 'storage.scanFilesCount' : 'storage.scanNamesCount', { done: scan.done, total: scan.total })
                    : tr(scan.why === 'files' ? 'storage.scanFiles' : 'storage.scanNames')}
                </p>
                <div className="sp-progress"><i style={{ width: `${scan.total ? (scan.done / scan.total) * 100 : 4}%` }} /></div>
                <span>{tr(scan.why === 'files' ? 'storage.scanFilesNote' : 'storage.scanNamesNote')}</span>
              </div>
            ) : state === 'loading' && !rows.length ? (
              <div className="sp-skel" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div>
            ) : !rows.length && !error ? (
              <div className="sp-empty">
                <Icon name="inbox" size={22} />
                <p>{filter ? tr('storage.emptyIn', folderVars(filter)) : tr('storage.empty')}</p>
              </div>
            ) : (
              <ul className={`sp-rows${busy ? ' is-busy' : ''}`}>
                {rows.map(i => (
                  <li key={i.id}>
                    {/* A linha abre o e-mail na pasta dele; a caixinha só seleciona. */}
                    <div className={`sp-row${selected.has(i.id) ? ' is-on' : ''}`} role="button" tabIndex={0}
                      onClick={() => navigate(`/caixa/${i.folder}/${i.id}`)}
                      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(`/caixa/${i.folder}/${i.id}`); } }}>
                      <span className="sp-check-hit" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="sp-check" checked={selected.has(i.id)} onChange={() => toggle(i)} />
                      </span>
                      <ItemLine item={i} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={sentinel} className="sp-sentinel" />
            {state === 'more' && <p className="sp-loading"><span className="spinner" />{tr('common.loading')}</p>}
            {state === 'ready' && canMore && rows.length > 0 && <button className="st-more sp-more" onClick={more}>{tr('common.loadMore')}</button>}
          </section>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sp-selbar" role="region" aria-label={tr('mailbox.selection')}>
          <p><strong>{tn('storage.selected', selected.size)}</strong><span>{space(selBytes)}</span></p>
          <button className="st-cancel" onClick={() => setSelected(new Map())}>{tr('storage.clear')}</button>
          <button className="btn btn-primary" onClick={() => setDialog({ kind: 'selected', ids: [...selected.keys()], bytes: selBytes })}>
            <Icon name="trash" size={16} />{rich(tr('storage.deleteBtn'), { long: s => <span className="sp-long">{s}</span> })}
          </button>
        </div>
      )}

      {dialog?.kind === 'selected' && (
        <HoldDialog
          title={dialog.ids.length === 1 ? tr('storage.delOneTitle') : tn('storage.delManyTitle', dialog.ids.length)}
          text={tr(dialog.ids.length === 1 ? 'storage.delOneText' : 'storage.delManyText', { size: space(dialog.bytes) })}
          holdLabel={dialog.ids.length === 1 ? tr('storage.holdOne') : tn('storage.holdMany', dialog.ids.length)}
          busyTitle={dialog.ids.length === 1 ? tr('storage.busyOne') : tn('storage.busyMany', dialog.ids.length)}
          onClose={() => setDialog(null)}
          run={async report => {
            const ids = dialog.ids;
            const before = summary?.used ?? 0;
            const r = await deleteForeverAnywhere(ids, done => report({ done, total: ids.length, line: tr('common.progress', { done, total: ids.length }) }));
            const gone = new Set(r.gone);
            setItems(prev => prev.filter(i => !gone.has(i.id)));
            setSelected(prev => new Map([...prev].filter(([id]) => !gone.has(id))));
            const s = await refreshSummary();
            const freed = s ? Math.max(0, before - s.used) : 0;
            if (!r.failed.length) {
              say(tn('storage.deletedForever', r.gone.length, { size: space(freed) }));
              return null;
            }
            return {
              title: tr('storage.partialTitle'),
              lines: [tn('storage.deletedFreed', r.gone.length, { size: space(freed) }), tn('storage.partialFailed', r.failed.length)],
            };
          }}
        />
      )}

      {dialog?.kind === 'files' && (
        <HoldDialog
          title={dialog.folder ? tr('storage.filesTitleIn', folderVars(dialog.folder)) : tr('storage.filesTitle')}
          text={[tn('storage.filesText', dialog.items.length, { size: space(dialog.bytes) }), dialog.locked ? tn('storage.filesLocked', dialog.locked) : ''].filter(Boolean).join(' ')}
          holdLabel={tr('storage.holdFiles')}
          busyTitle={tr('storage.busyFiles')}
          busyHint={tr('storage.busyFilesHint')}
          stoppable
          onClose={() => setDialog(null)}
          run={async (report, stopped) => {
            const r = await stripAll(dialog.items, key, p => report({
              done: p.done, total: p.total,
              line: [tr('storage.filesLine', { done: p.done, total: p.total, size: space(p.freed) }), p.failed ? tn('storage.filesErrors', p.failed) : ''].filter(Boolean).join(' · '),
            }), stopped);
            await reloadAfter();
            const lines = [tn('storage.filesDone', r.changed, { size: space(r.freed) })];
            if (r.skipped) lines.push(tn('storage.filesSkipped', r.skipped));
            if (r.failed.length) {
              const list = r.failed.slice(0, 3).map(f => `"${f.item.subject || tr('common.noSubject')}"`).join(', ');
              const names = r.failed.length > 3 ? tr('common.andMore', { names: list, n: r.failed.length - 3 }) : list;
              lines.push(tn('storage.filesFailed', r.failed.length, { names }));
            }
            if (r.stopped) lines.push(tr('storage.filesStopped'));
            return { title: tr(r.stopped ? 'storage.stopped' : r.failed.length ? 'storage.doneWithErrors' : 'storage.done'), lines };
          }}
        />
      )}

      {dialog?.kind === 'all' && (
        <HoldDialog
          title={dialog.folder ? tr('storage.allTitleIn', folderVars(dialog.folder)) : tr('storage.allTitle')}
          text={dialog.folder
            ? (dialog.count === 1 ? tr('storage.allTextInOne', { ...folderVars(dialog.folder), size: space(dialog.bytes) })
              : tn('storage.allTextIn', dialog.count, { ...folderVars(dialog.folder), size: space(dialog.bytes) }))
            : (dialog.count === 1 ? tr('storage.allTextOne', { size: space(dialog.bytes) }) : tn('storage.allText', dialog.count, { size: space(dialog.bytes) }))}
          holdLabel={dialog.count === 1 ? tr('storage.holdOne') : tn('storage.holdMany', dialog.count)}
          holdMs={2000}
          busyTitle={dialog.count === 1 ? tr('storage.busyOne') : tn('storage.busyMany', dialog.count)}
          stoppable
          onClose={() => setDialog(null)}
          run={async (report, stopped) => {
            const { count, bytes: before, at, folder } = dialog;
            let done = 0;
            let broke = '';
            try {
              done = (await deleteEverything(at, folder, n => report({ done: n, total: count, line: tr('common.progress', { done: n, total: count }) }), stopped)).done;
            } catch (e) { broke = fail(e, tr('storage.connDropped')); }
            const s = await reloadAfter();
            const left = s ? totalOf(s, folder) : 0;
            const freed = s ? Math.max(0, before - bytesOf(s, folder)) : 0;
            const lines = [tn('storage.deletedFreed', done, { size: space(freed) })];
            if (broke) lines.push(tr('storage.broke', { error: broke }));
            else if (stopped() && done < count) lines.push(tr('storage.allStopped'));
            if (left && !broke && !stopped()) lines.push(tn('storage.arrivedAfter', left));
            const title = broke || (stopped() && done < count) ? tr('storage.notAll')
              : left ? tr('storage.done') : folder ? tr('storage.doneNothingIn', folderVars(folder)) : tr('storage.doneEmpty');
            return { title, lines };
          }}
        />
      )}
    </main>
  );
}

type Progress = { done: number; total: number; line: string };
type Outcome = { title: string; lines: string[] } | null;

// Confirmação no jeito de uma folha do sistema: título, uma ou duas frases com o número exato, o aviso
// e o botão de segurar ocupando a largura. Esc e clique fora cancelam antes de começar; durante o
// trabalho só o "Parar" interrompe, e no fim aparece o resultado.
function HoldDialog({ title, text, holdLabel, holdMs = 1200, busyTitle, busyHint, stoppable, run, onClose }: {
  title: string; text: string; holdLabel: string; holdMs?: number; busyTitle: string; busyHint?: string;
  stoppable?: boolean; run: (report: (p: Progress) => void, stopped: () => boolean) => Promise<Outcome>; onClose: () => void;
}) {
  const [phase, setPhase] = useState<'ask' | 'run' | 'done'>('ask');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [outcome, setOutcome] = useState<NonNullable<Outcome> | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    return () => back?.focus();
  }, []);
  // Foco no botão seguro de cada fase: Cancelar, Parar, OK.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[data-focus]')?.focus();
  }, [phase]);
  // Parar quando a tela sai no meio do trabalho (zerado na montagem: o modo estrito monta duas vezes).
  useEffect(() => {
    stopRef.current = false;
    return () => { stopRef.current = true; };
  }, []);

  async function start() {
    setPhase('run');
    try {
      const r = await run(p => setProgress(p), () => stopRef.current);
      if (!r) { onClose(); return; }
      setOutcome(r);
    } catch (e) {
      setOutcome({ title: tr('storage.failTitle'), lines: [fail(e, tr('common.genericError'))] });
    }
    setPhase('done');
  }

  function keys(e: KeyboardEvent) {
    if (e.key === 'Escape' && phase !== 'run') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') {
      const list = [...(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
    }
  }

  const pct = progress && progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0;
  return createPortal(
    <div className="sp-sheet-scrim" onMouseDown={e => { if (e.target === e.currentTarget && phase !== 'run') onClose(); }} onKeyDown={keys}>
      <div ref={box} className="sp-sheet" role="alertdialog" aria-modal="true" aria-labelledby="sp-sheet-title" aria-describedby="sp-sheet-text">
        {phase === 'ask' && (
          <>
            <h3 id="sp-sheet-title">{title}</h3>
            <p id="sp-sheet-text">{text}</p>
            <p className="sp-sheet-warn">{tr('storage.noUndo')}</p>
            <div className="sp-sheet-actions">
              <HoldButton label={holdLabel} ms={holdMs} onDone={start} />
              <button className="sp-sheet-quiet" data-focus onClick={onClose}>{tr('common.cancel')}</button>
            </div>
          </>
        )}
        {phase === 'run' && (
          <>
            <h3 id="sp-sheet-title">{busyTitle}</h3>
            <div className="sp-progress sp-sheet-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress?.total || 1} aria-valuenow={progress?.done || 0}>
              <i style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <p id="sp-sheet-text" className="sp-sheet-line" aria-live="polite">{progress?.line ?? tr('storage.starting')}</p>
            {busyHint && <p>{busyHint}</p>}
            {stoppable && (
              <div className="sp-sheet-actions">
                <button className="sp-sheet-quiet" data-focus disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); }}>
                  {stopping ? <><span className="spinner" />{tr('storage.stopping')}</> : tr('storage.stop')}
                </button>
              </div>
            )}
          </>
        )}
        {phase === 'done' && outcome && (
          <>
            <h3 id="sp-sheet-title">{outcome.title}</h3>
            <div id="sp-sheet-text">{outcome.lines.map(l => <p key={l}>{l}</p>)}</div>
            <div className="sp-sheet-actions">
              <button className="sp-sheet-ok" data-focus onClick={onClose}>{tr('common.ok')}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Botão de segurar, destrutivo: o vermelho enche da esquerda para a direita enquanto o dedo (ou
// Espaço/Enter) fica apertado. Soltar antes volta ao zero e lembra de segurar; ao encher, confirma.
function HoldButton({ label, ms, onDone }: { label: string; ms: number; onDone: () => void }) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const timer = useRef(0);
  const hintTimer = useRef(0);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);
  useEffect(() => () => { window.clearTimeout(timer.current); window.clearTimeout(hintTimer.current); }, []);

  function press() {
    if (holding) return;
    setHolding(true);
    setHint(false);
    timer.current = window.setTimeout(() => { timer.current = 0; doneRef.current(); }, ms);
  }
  function release() {
    if (!timer.current) return;
    window.clearTimeout(timer.current);
    timer.current = 0;
    setHolding(false);
    setHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(false), 1800);
  }

  const text = hint ? tr('storage.keepHolding') : label;
  return (
    <button type="button" className={`hold${holding ? ' is-holding' : ''}`} style={{ ['--hold' as string]: `${ms}ms` }}
      onPointerDown={e => { if (e.button === 0) press(); }} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
      onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } }}
      onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') release(); }}
      onBlur={release} onContextMenu={e => e.preventDefault()}
      aria-label={tr('storage.holdAria', { label, duration: secondsLabel(ms / 1000) })}>
      <span className="hold-label">{text}</span>
      <span className="hold-fill" aria-hidden="true"><span className="hold-label">{text}</span></span>
    </button>
  );
}
