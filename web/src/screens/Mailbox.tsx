import type { Email } from 'postal-mime';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { people, type Person } from '../../../shared/head';
import { api } from '../lib/api';
import { displayName, fullDate, initials, shortDate, size, textDir } from '../lib/format';
import { cleanSubject, deleteForever, listFolder, readMessage, threadsOf, unreadCounts, updateMessages, type Folder, type Item, type Thread, setPinOwner } from '../lib/mailbox';
import { useIdleSignOut } from '../lib/idle';
import { navigate, usePath } from '../lib/router';
import { getSecurity } from '../lib/security';
import type { Session } from '../lib/session';
import { currentTheme, setTheme, type Theme } from '../lib/theme';
import { Icon, Logo, type IconName } from '../ui/Icon';
import { SwipeRow } from '../ui/SwipeRow';
import { Composer, type ComposeSeed } from './Composer';
import { Profile } from './Profile';
import { AgentsPage } from './AgentsPage';
import { ConnectCli } from './ConnectCli';
import { Storage } from './Storage';
import { Reader, type ReaderAction } from './Reader';
import { AccountMenu } from '../ui/AccountMenu';
import { EmptyFlight } from '../ui/EmptyFlight';
import { EmptyShield } from '../ui/EmptyShield';
import { liveOpen, watchMailbox } from '../lib/live';
import { loadOrder, saveOrder, useSortable } from '../lib/sortable';
import { pending, type Pending } from '../lib/attach';
import { Avatar } from '../ui/Avatar';
import { t as tr, tn } from '../i18n';
import { rich } from '../i18n/rich';
import './list-line.css';

// Nome, texto da pasta vazia e a dica embaixo dele (Entrada e Spam) vêm do dicionário (mailbox.folders,
// .empty, .hint).
const FOLDERS: { id: Folder; icon: IconName }[] = [
  { id: 'inbox', icon: 'inbox' },
  { id: 'starred', icon: 'star' },
  { id: 'sent', icon: 'send' },
  { id: 'drafts', icon: 'pen' },
  { id: 'archive', icon: 'archive' },
  { id: 'spam', icon: 'spam' },
  { id: 'trash', icon: 'trash' },
];
const folderName = (f: Folder) => tr(`mailbox.folders.${f}`);

type Toast = { text: string; undo?: () => void; sealed?: boolean; leaving?: boolean };

function parsePath(path: string): { folder: Folder; id: string | null } {
  const m = /^\/caixa\/([a-z]+)(?:\/([\w-]+))?/.exec(path);
  const folder = (FOLDERS.find(f => f.id === m?.[1])?.id ?? 'inbox') as Folder;
  return { folder, id: m?.[2] ?? null };
}

const reSubject = (prefix: string, s: string) => `${prefix}: ${cleanSubject(s)}`;

function quoteOf(item: Item, email: Email) {
  const from = item.h.from ? `${displayName(item.h.from)} <${item.h.from.address}>` : tr('common.someone');
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return { header: tr('mailbox.quoteHeader', { date: fullDate(item.h.date), from }), html: email.html || esc(email.text || '') };
}

// Quem aparece na linha da conversa: os remetentes, com "você" para as suas mensagens.
function participants(t: Thread): string {
  const names: string[] = [];
  for (const i of t.items) {
    const n = i.folder === 'sent' ? tr('common.youInList') : displayName(i.h.from).split(/\s+/)[0];
    if (!names.includes(n)) names.push(n);
  }
  if (names.length === 1 && names[0] !== tr('common.youInList')) return displayName(t.items.find(i => i.folder !== 'sent')?.h.from);
  return names.join(', ');
}

// Para onde vai cada ação que tira a conversa da pasta, com o aviso de uma e de várias.
type MoveAction = 'archive' | 'inbox' | 'trash' | 'restore' | 'spam' | 'notspam';
type MoveText = 'archive' | 'inbox' | 'trash' | 'restore' | 'spam';
const MOVES: Record<MoveAction, { to: Exclude<Folder, 'starred'>; text: MoveText }> = {
  archive: { to: 'archive', text: 'archive' },
  inbox: { to: 'inbox', text: 'inbox' },
  trash: { to: 'trash', text: 'trash' },
  restore: { to: 'inbox', text: 'restore' },
  spam: { to: 'spam', text: 'spam' },
  notspam: { to: 'inbox', text: 'restore' },
};
const moveText = (a: MoveAction, n = 1) => (n === 1 ? tr(`mailbox.moved.${MOVES[a].text}`) : tn(`mailbox.movedMany.${MOVES[a].text}`, n));
const isMove = (a: string): a is MoveAction => a in MOVES;

// Formato da lista, guardado neste aparelho: em linha (o padrão) ou colunas (lista e leitura lado a lado).
type Layout = 'cols' | 'line';
const LAYOUT_KEY = 'shalom-list-layout';
const savedLayout = (): Layout => (localStorage.getItem(LAYOUT_KEY) === 'cols' ? 'cols' : 'line');

// Tela larga (acima de 900 px). No celular a lista é sempre a de uma coluna.
function useWide() {
  const query = '(min-width: 901px)';
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

// Caixa de seleção da lista em linha: preta quando marcada no claro, branca no escuro.
function CheckBox({ checked, mixed = false, label, onToggle, disabled }: {
  checked: boolean; mixed?: boolean; label: string; onToggle: (e: MouseEvent) => void; disabled?: boolean;
}) {
  return (
    <button type="button" role="checkbox" className="check" aria-checked={mixed ? 'mixed' : checked} aria-label={label} onClick={onToggle} disabled={disabled}>
      <span className="check-box">
        {(checked || mixed) && <svg viewBox="0 0 16 16" aria-hidden="true"><path d={mixed ? 'M4.5 8h7' : 'M4 8.3l2.6 2.6L12 5.5'} /></svg>}
      </span>
    </button>
  );
}

export function Mailbox({ session, onSignOut, onUser }: { session: Session; onSignOut: (why?: string) => void; onUser: (u: Session['user']) => void }) {
  const { user, secretKey } = session;
  // Chaves de contato fixadas são desta conta: o recebimento confere contra elas.
  setPinOwner(user.id);
  const path = usePath();
  const { folder, id } = parsePath(path);
  const onProfile = path === '/perfil' || path === '/perfil/espaco' || path === '/agentes-ia' || path === '/conectar';
  const [avatarV, setAvatarV] = useState(() => Date.now());
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [extra, setExtra] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const moreRef = useRef(more);
  moreRef.current = more;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Partial<Record<Folder, number>>>({});
  const [query, setQuery] = useState('');
  const [compose, setCompose] = useState<ComposeSeed | null>(null);
  // Resposta e encaminhamento abrem dentro da conversa; a janela flutuante é só para mensagem nova.
  const [inline, setInline] = useState<{ key: string; seed: ComposeSeed } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [theme, setThemeState] = useState<Theme>(currentTheme());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [composeLeaving, setComposeLeaving] = useState(false);
  const [pop, setPop] = useState<'key' | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [idle, setIdle] = useState<number | null>(null);
  const toastTimer = useRef<number>(0);
  const footRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const [layout, setLayout] = useState<Layout>(savedLayout);
  // Lista em linha só na tela larga; no celular continua a lista de uma coluna.
  const line = layout === 'line' && wide;
  // Conversas marcadas (pela chave) e o cursor do teclado na lista em linha.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const [confirmForever, setConfirmForever] = useState(false);
  const lastCheck = useRef<string | null>(null);

  // A outra pasta que completa as conversas: Enviados, ou a Entrada quando a pasta aberta é Enviados.
  const extraFolder: Folder = folder === 'sent' ? 'inbox' : 'sent';

  useEffect(() => { if (!path.startsWith('/caixa/') && !onProfile) navigate('/caixa/inbox', true); }, [path, onProfile]);

  // Sair por inatividade no tempo que a pessoa escolheu (o servidor também derruba a sessão parada).
  useEffect(() => { getSecurity().then(s => setIdle(s.idle)).catch(() => {}); }, []);
  useIdleSignOut(idle, () => onSignOut(tr('mailbox.idleOut')));

  // Espaço usado: ao abrir, a cada 5 minutos com a aba na frente e logo depois de apagar algo pelo Espaço.
  useEffect(() => {
    const load = () => { if (document.visibilityState === 'visible') api<{ used: number; quota: number }>('/usage').then(setUsage).catch(() => {}); };
    load();
    const t = window.setInterval(load, 5 * 60_000);
    window.addEventListener('shalom:storage', load);
    return () => { window.clearInterval(t); window.removeEventListener('shalom:storage', load); };
  }, []);

  const hideToast = useCallback(() => {
    setToast(t => (t ? { ...t, leaving: true } : t));
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 160);
  }, []);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(hideToast, 5000);
  }, [hideToast]);

  // Popovers da conta e da chave fecham com clique fora ou Esc.
  useEffect(() => {
    if (!pop) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !footRef.current?.contains(e.target as Node)) setPop(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [pop]);

  function openCompose(seed: ComposeSeed) {
    setComposeLeaving(false);
    setCompose(seed);
    setDrawer(false);
  }

  function closeCompose(after?: () => void) {
    setComposeLeaving(true);
    window.setTimeout(() => { setCompose(null); setComposeLeaving(false); after?.(); }, 160);
  }

  // Pasta aberta agora e a última lista de cada pasta nesta sessão. Trocar de pasta mostra na hora a
  // lista guardada dela (ou o esqueleto) e atualiza por trás; resposta que chega depois da troca, de
  // outra pasta, é descartada. Sem isso, as linhas da pasta anterior apareciam por um instante na nova.
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const folderCache = useRef(new Map<Folder, { items: Item[]; extra: Item[]; more: boolean }>());

  const refresh = useCallback(async (quiet = false) => {
    const asked = folder;
    if (!quiet) setLoading(true);
    try {
      const [main, other] = await Promise.all([listFolder(folder, secretKey), listFolder(extraFolder, secretKey).catch(() => null)]);
      if (folderRef.current !== asked) return;
      // A atualização de fundo troca só a primeira página: o que a pessoa já carregou além dela fica.
      const oldest = main.items[main.items.length - 1]?.received_at ?? 0;
      const keepTail = quiet && main.more && itemsRef.current.length > main.items.length;
      const nextItems = keepTail ? [...main.items, ...itemsRef.current.filter(i => i.received_at < oldest)] : main.items;
      const nextMore = keepTail ? moreRef.current : main.more;
      setItems(nextItems);
      setMore(nextMore);
      setCounts(main.counts);
      if (other) setExtra(other.items);
      folderCache.current.set(asked, { items: nextItems, extra: other?.items ?? [], more: nextMore });
      setError('');
    } catch (e) {
      if (!quiet && folderRef.current === asked) setError(e instanceof Error ? e.message : tr('mailbox.loadFail'));
    } finally {
      if (folderRef.current === asked) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, extraFolder, secretKey]);

  // Antes de a tela ser desenhada (useLayoutEffect): sem isso, o primeiro quadro da pasta nova saía com a
  // lista da anterior, ou com o "vazio" dela, e só depois trocava.
  useLayoutEffect(() => {
    setQuery('');
    const saved = folderCache.current.get(folder);
    setItems(saved?.items ?? []);
    setExtra(saved?.extra ?? []);
    setMore(saved?.more ?? false);
    refresh(!!saved);
    listRef.current?.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // As outras pastas ficam guardadas também, carregadas por trás depois da primeira lista e de cada
  // novidade: trocar de pasta mostra a lista (ou o vazio) na hora, sem esperar o servidor.
  const prefetchRun = useRef(0);
  const prefetchOthers = useCallback(async () => {
    const run = ++prefetchRun.current;
    for (const f of ['sent', 'inbox', 'starred', 'drafts', 'archive', 'spam', 'trash'] as Folder[]) {
      if (run !== prefetchRun.current) return;
      if (f === folderRef.current) continue;
      try {
        const r = await listFolder(f, secretKey);
        if (run !== prefetchRun.current || f === folderRef.current) continue;
        const extraOf = folderCache.current.get(f === 'sent' ? 'inbox' : 'sent')?.items ?? [];
        folderCache.current.set(f, { items: r.items, extra: extraOf, more: r.more });
      } catch { /* fica sem guardar: a pasta carrega quando for aberta */ }
    }
  }, [secretKey]);
  const prefetched = useRef(false);
  useEffect(() => {
    if (loading || prefetched.current) return;
    prefetched.current = true;
    const t = window.setTimeout(() => prefetchOthers(), 600);
    return () => window.clearTimeout(t);
  }, [loading, prefetchOthers]);
  const prefetchRef = useRef(prefetchOthers);
  prefetchRef.current = prefetchOthers;
  // Apagou pelo Espaço: lista e não lidas da lateral se atualizam na hora.
  useEffect(() => {
    const again = () => refresh(true);
    window.addEventListener('shalom:storage', again);
    return () => window.removeEventListener('shalom:storage', again);
  }, [refresh]);

  // Caixa ao vivo: chegou ou mudou algo (aqui, em outra aba ou em outro aparelho), a lista se atualiza
  // na hora. Avisos em sequência (uma ação em lote) viram uma busca só.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    let t = 0;
    let later = 0;
    const soon = () => {
      window.clearTimeout(t);
      window.clearTimeout(later);
      t = window.setTimeout(() => refreshRef.current(true), 250);
      later = window.setTimeout(() => prefetchRef.current(), 1500);
    };
    const stop = watchMailbox(soon, soon);
    return () => { window.clearTimeout(t); window.clearTimeout(later); stop(); };
  }, []);

  // Reserva da caixa ao vivo, só com a aba aberta na frente: a cada minuto se a conexão ao vivo caiu, e a
  // cada 5 minutos com ela aberta (ela já avisa de tudo; a busca só cobre algum aviso perdido).
  useEffect(() => {
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (liveOpen() && Date.now() - last < 5 * 60_000) return;
      last = Date.now();
      refresh(true);
    };
    const back = () => { if (document.visibilityState === 'visible') { last = Date.now(); refresh(true); } };
    const t = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', back);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [refresh]);

  const loadingMore = useRef(false);
  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loadingMore.current) return;
    loadingMore.current = true;
    const asked = folder;
    try {
      const r = await listFolder(folder, secretKey, last.received_at);
      // Trocou de pasta enquanto carregava: estas linhas são da anterior.
      if (folderRef.current !== asked) return;
      const have = new Set(itemsRef.current.map(i => i.id));
      const nextItems = [...itemsRef.current, ...r.items.filter(i => !have.has(i.id))];
      setItems(nextItems);
      setMore(r.more);
      const saved = folderCache.current.get(asked);
      if (saved) folderCache.current.set(asked, { ...saved, items: nextItems, more: r.more });
    } finally { loadingMore.current = false; }
  }

  // Rascunho é uma mensagem só: não junta com a conversa de Enviados.
  const threads = useMemo(() => threadsOf(items, folder === 'drafts' ? [] : extra), [items, extra, folder]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(t => t.items.some(i => [i.h.subject, i.h.snippet, i.h.from?.name, i.h.from?.address].some(v => v?.toLowerCase().includes(q))));
  }, [threads, query]);

  const selected = id ? threads.find(t => t.items.some(i => i.id === id)) ?? null : null;
  // Link direto para uma mensagem antiga (vindo do Espaço) que ainda não está na lista: carrega as
  // próximas páginas até ela aparecer.
  useEffect(() => {
    if (id && !selected && !loading && more && items.length) loadMore().catch(() => {});
  }, [id, selected, loading, more, items.length]);
  // A busca roda no aparelho, só no que já foi baixado: com texto na busca, baixa o resto da pasta.
  useEffect(() => {
    if (query.trim() && !loading && more && items.length) loadMore().catch(() => {});
  }, [query, loading, more, items.length]);
  const sel = useMemo(() => visible.filter(t => checked.has(t.key)), [visible, checked]);

  // Trocar de pasta ou de formato desmarca tudo.
  useEffect(() => { setChecked(new Set()); setCursor(null); lastCheck.current = null; }, [folder, layout]);
  useEffect(() => setConfirmForever(false), [checked]);
  // "Apagar de vez" armado desarma com clique fora ou Esc (sem desmarcar as conversas).
  useEffect(() => {
    if (!confirmForever) return;
    const off = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
      } else if ((e.target as Element).closest?.('.tools-confirm')) return;
      setConfirmForever(false);
    };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', off);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', off); };
  }, [confirmForever]);

  // Rascunho abre de volta na caixa de escrever, com texto, fotos e anexos.
  async function openDraft(item: Item) {
    try {
      const email = await readMessage(item.id, secretKey, item);
      const files: Pending[] = [];
      let html = new DOMParser().parseFromString(email.html || '', 'text/html').body.firstElementChild?.innerHTML ?? '';
      for (const a of email.attachments) {
        const bytes = typeof a.content === 'string' ? new TextEncoder().encode(a.content) : new Uint8Array(a.content);
        const file = new File([bytes], a.filename || 'anexo', { type: a.mimeType || 'application/octet-stream' });
        const cid = a.contentId?.replace(/^<|>$/g, '');
        const p = pending(file, !!cid && html.includes(`cid:${cid}`));
        if (p.inline && cid) html = html.split(`cid:${cid}`).join(p.url);
        files.push(p);
      }
      openCompose({
        title: tr('mailbox.newMessage'),
        to: people(email.to), cc: people(email.cc), bcc: people(email.bcc),
        subject: email.subject ?? '', inReplyTo: email.inReplyTo, references: email.references,
        draft: { id: item.id, html, files },
      });
    } catch (e) {
      showToast({ text: e instanceof Error && e.message ? e.message : tr('common.openFail') });
    }
  }

  function open(t: Thread) {
    const target = t.inFolder[t.inFolder.length - 1] ?? t.latest;
    if (folder === 'drafts') { openDraft(target); return; }
    navigate(`/caixa/${folder}/${target.id}`);
    setCursor(t.key);
    markRead([t]);
  }

  function closeReader() { navigate(`/caixa/${folder}`); }

  // Lista em linha: leva o cursor até a conversa, rolando só o necessário.
  function focusRow(key: string) {
    setCursor(key);
    const row = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector<HTMLElement>('.lrow-open')?.focus({ preventScroll: true });
  }

  // Voltou da conversa para a lista em linha: a lista está onde ficou e o cursor na conversa lida.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (line && !selected && wasOpen.current && cursor) requestAnimationFrame(() => focusRow(cursor));
    wasOpen.current = !!selected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, line]);

  function markRead(ts: Thread[]) {
    const ids = new Set(ts.flatMap(t => t.inFolder.filter(i => !i.seen).map(i => i.id)));
    if (!ids.size) return;
    setItems(prev => prev.map(i => (ids.has(i.id) ? { ...i, seen: 1 } : i)));
    updateMessages([...ids], { seen: true }).then(setCounts).catch(() => {});
  }

  // Não lida volta a ser a última mensagem de cada conversa, como no leitor.
  function markUnread(ts: Thread[]) {
    const ids = new Set(ts.map(t => t.inFolder[t.inFolder.length - 1]?.id).filter((x): x is string => !!x));
    if (!ids.size) return;
    setItems(prev => prev.map(i => (ids.has(i.id) ? { ...i, seen: 0 } : i)));
    updateMessages([...ids], { seen: false }).then(setCounts).catch(() => refresh(true));
  }

  // Tira as conversas da pasta aberta: as linhas recolhem em 180 ms e só então saem. Desfazer devolve
  // cada mensagem para a pasta de onde veio.
  function moveOut(ts: Thread[], to: Exclude<Folder, 'starred'>, text: string) {
    const moved = ts.flatMap(t => t.inFolder);
    const ids = new Set(moved.map(i => i.id));
    const keys = new Set(ts.map(t => t.key));
    const after = (key: string) => {
      const at = visible.findIndex(x => x.key === key);
      return visible.slice(at + 1).find(x => !keys.has(x.key)) ?? visible.slice(0, Math.max(0, at)).reverse().find(x => !keys.has(x.key));
    };
    setLeaving(prev => new Set([...prev, ...keys]));
    window.setTimeout(() => {
      setItems(prev => prev.filter(i => !ids.has(i.id)));
      setLeaving(prev => { const n = new Set(prev); for (const k of keys) n.delete(k); return n; });
    }, 180);
    if (selected && keys.has(selected.key)) {
      const at = visible.findIndex(x => x.key === selected.key);
      const next = visible.slice(at + 1).find(x => !keys.has(x.key));
      // Em linha, volta para a lista com o cursor na seguinte; em colunas, a seguinte já abre ao lado.
      if (line) { setCursor(after(selected.key)?.key ?? null); navigate(`/caixa/${folder}`, true); }
      else navigate(next ? `/caixa/${folder}/${(next.inFolder[next.inFolder.length - 1] ?? next.latest).id}` : `/caixa/${folder}`, true);
    } else if (cursor && keys.has(cursor)) setCursor(after(cursor)?.key ?? null);
    updateMessages([...ids], { folder: to }).then(setCounts).catch(() => refresh(true));
    showToast({
      text,
      undo: () => {
        setItems(prev => [...prev.filter(i => !ids.has(i.id)), ...moved].sort((a, b) => b.received_at - a.received_at));
        const back = new Map<Exclude<Folder, 'starred'>, string[]>();
        for (const i of moved) back.set(i.folder, [...(back.get(i.folder) ?? []), i.id]);
        for (const [f, list] of back) updateMessages(list, { folder: f }).then(setCounts);
        hideToast();
      },
    });
  }

  // Apagar de vez espera o aviso sumir (5 s) com o Desfazer na tela: um toque errado no Spam ou na
  // Lixeira, no leitor ou no arrastar do celular, não leva o e-mail embora.
  function forever(ts: Thread[]) {
    const moved = ts.flatMap(t => t.inFolder);
    const ids = moved.map(i => i.id);
    const gone = new Set(ids);
    setItems(prev => prev.filter(i => !gone.has(i.id)));
    if (selected && ts.some(t => t.key === selected.key)) closeReader();
    let undone = false;
    const timer = window.setTimeout(async () => {
      if (undone) return;
      try { await deleteForever(ids); } catch { refresh(true); return; }
      unreadCounts().then(setCounts).catch(() => {});
    }, 5200);
    showToast({
      text: ts.length > 1 ? tn('mailbox.deletedMany', ts.length) : ids.length > 1 ? tr('mailbox.deletedThread') : tr('mailbox.deletedOne'),
      undo: () => {
        undone = true;
        window.clearTimeout(timer);
        setItems(prev => [...prev.filter(i => !gone.has(i.id)), ...moved].sort((a, b) => b.received_at - a.received_at));
        hideToast();
      },
    });
  }

  // Barra da seleção: a ação vale para todas as conversas marcadas.
  function bulk(a: MoveAction | 'forever' | 'read' | 'unread') {
    const ts = sel;
    if (!ts.length) return;
    if (a === 'read') return markRead(ts);
    if (a === 'unread') return markUnread(ts);
    setChecked(new Set());
    if (a === 'forever') return forever(ts);
    moveOut(ts, MOVES[a].to, moveText(a, ts.length));
  }

  // Marca ou desmarca a conversa; com Shift, o trecho desde a última marcada.
  function toggleCheck(t: Thread, range = false) {
    const from = range && lastCheck.current ? visible.findIndex(x => x.key === lastCheck.current) : -1;
    const to = visible.findIndex(x => x.key === t.key);
    setChecked(prev => {
      const next = new Set(prev);
      const on = !prev.has(t.key);
      const span = from >= 0 && to >= 0 ? visible.slice(Math.min(from, to), Math.max(from, to) + 1) : [t];
      for (const x of span) { if (on) next.add(x.key); else next.delete(x.key); }
      return next;
    });
    lastCheck.current = t.key;
    setCursor(t.key);
  }

  function toggleLayout() {
    const next: Layout = layout === 'line' ? 'cols' : 'line';
    localStorage.setItem(LAYOUT_KEY, next);
    // Indo para a lista com um e-mail aberto ao lado: fecha o e-mail e mostra a lista inteira.
    const apply = () => flushSync(() => { setLayout(next); if (next === 'line' && id) navigate(`/caixa/${folder}`, true); });
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition) doc.startViewTransition(apply); else apply();
  }

  const threadKeyOfItem = (item: Item) => threads.find(t => t.items.some(i => i.id === item.id))?.key ?? '';

  function reply(item: Item, email: Email, all: boolean) {
    const me = user.address;
    const sender: Person[] = people(email.replyTo).length ? people(email.replyTo) : people(email.from);
    const to = item.folder === 'sent' ? people(email.to) : sender;
    const extraTo = all ? people(email.to).filter(p => p.address !== me && !to.some(t => t.address === p.address)) : [];
    const cc = all ? people(email.cc).filter(p => p.address !== me) : [];
    setInline({ key: threadKeyOfItem(item), seed: {
      title: tr(all ? 'mailbox.replyAll' : 'mailbox.reply'),
      mode: all ? 'replyAll' : 'reply',
      quotedFrom: item.h.from ? displayName(item.h.from) : undefined,
      to: [...to, ...extraTo].filter(p => p.address !== me || item.folder === 'sent'),
      cc,
      subject: reSubject(tr('mailbox.rePrefix'), item.h.subject),
      quoted: quoteOf(item, email),
      inReplyTo: email.messageId,
      references: [email.references, email.messageId].filter(Boolean).join(' '),
    } });
  }

  async function act(a: ReaderAction, t: Thread, item?: Item, email?: Email) {
    const ids = t.inFolder.map(i => i.id);
    if (isMove(a)) return moveOut([t], MOVES[a].to, moveText(a));
    switch (a) {
      case 'forever': return forever([t]);
      case 'unread': {
        markUnread([t]);
        return closeReader();
      }
      case 'pin': {
        const pinned = t.pinned ? 0 : 1;
        setItems(prev => prev.map(i => (ids.includes(i.id) ? { ...i, pinned } : i)));
        showToast({ text: tr(pinned ? 'mailbox.pinned' : 'mailbox.unpinned') });
        return updateMessages(ids, { pinned: !!pinned });
      }
      case 'star': {
        const starred = t.starred ? 0 : 1;
        setItems(prev => (folder === 'starred' && !starred ? prev.filter(i => !ids.includes(i.id)) : prev.map(i => (ids.includes(i.id) ? { ...i, starred } : i))));
        return updateMessages(ids, { starred: !!starred });
      }
      case 'reply': return item && email && reply(item, email, false);
      case 'replyAll': return item && email && reply(item, email, true);
      case 'forward':
        if (!item || !email) return;
        return setInline({ key: t.key, seed: {
          title: tr('mailbox.forward'),
          mode: 'forward',
          subject: reSubject(tr('mailbox.fwdPrefix'), item.h.subject),
          quotedFrom: item.h.from ? displayName(item.h.from) : undefined,
          quoted: {
            ...quoteOf(item, email),
            header: tr('mailbox.fwdHeader', { from: item.h.from ? `${displayName(item.h.from)} <${item.h.from.address}>` : tr('common.someone'), date: fullDate(item.h.date) }),
          },
        } });
    }
  }

  // Atalhos: C escreve, E arquiva, # lixeira, J e K andam na lista, Esc fecha.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable], .composer') || e.metaKey || e.ctrlKey || e.altKey) return;
      const folderOfSel = selected?.inFolder[0]?.folder;
      // Lista em linha sem conversa aberta: J e K levam o cursor, Enter abre, X marca, E e # valem
      // para as marcadas (ou para a do cursor) e Esc desmarca.
      if (line && !selected && e.key !== 'c') {
        const at = cursor ? visible.findIndex(t => t.key === cursor) : -1;
        const here = at >= 0 ? visible[at] : null;
        if (e.key === 'j' || e.key === 'k') {
          const next = visible[at < 0 ? 0 : e.key === 'j' ? Math.min(visible.length - 1, at + 1) : Math.max(0, at - 1)];
          if (next) { e.preventDefault(); focusRow(next.key); }
        } else if (e.key === 'x' && here) toggleCheck(here);
        else if ((e.key === 'e' || e.key === '#') && folder !== 'trash') {
          const ts = sel.length ? sel : here ? [here] : [];
          if (!ts.length) return;
          const a: MoveAction = e.key === '#' ? 'trash' : folder === 'archive' ? 'inbox' : 'archive';
          if (sel.length) bulk(a);
          else moveOut(ts, MOVES[a].to, moveText(a));
          window.setTimeout(() => { if (cursorRef.current) focusRow(cursorRef.current); }, 200);
        } else if (e.key === 'Escape' && sel.length) setChecked(new Set());
        return;
      }
      if (e.key === 'c') { e.preventDefault(); openCompose({ title: tr('mailbox.newMessage') }); }
      else if (e.key === 'e' && selected && folderOfSel !== 'trash') act(folderOfSel === 'archive' ? 'inbox' : 'archive', selected);
      else if (e.key === '#' && selected && folderOfSel !== 'trash') act('trash', selected);
      else if (e.key === 'j' || e.key === 'k') {
        const at = selected ? visible.findIndex(t => t.key === selected.key) : -1;
        const next = visible[e.key === 'j' ? at + 1 : Math.max(0, at - 1)];
        if (next) open(next);
      } else if (e.key === 'Escape' && selected) closeReader();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Troca de tema com transição curta da página inteira, onde o navegador suporta.
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    const apply = () => flushSync(() => { setTheme(next); setThemeState(next); });
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition) doc.startViewTransition(apply); else apply();
    setPop(null);
  }

  const current = FOLDERS.find(f => f.id === folder)!;
  // Ordem das pastas escolhida pela pessoa (arrastar ou Alt + seta), guardada por conta neste aparelho.
  const [folderOrder, setFolderOrder] = useState<Folder[]>(() => loadOrder(user.id, FOLDERS.map(f => f.id)));
  const { dragging, handlers } = useSortable(folderOrder, setFolderOrder, ids => saveOrder(user.id, ids));
  const sortedFolders = folderOrder.map(id => FOLDERS.find(f => f.id === id)!);
  // Entrada e Spam vazios ganham uma animação calma; as outras pastas, só o ícone.
  const calm = !query && (folder === 'inbox' || folder === 'spam');
  const allChecked = sel.length > 0 && sel.length === visible.length;
  // Botão de ícone da barra da seleção, com a dica (e o atalho, quando tem).
  const tool = (icon: IconName, label: string, run: () => void, key?: string) => (
    <button className="icon-btn" onClick={run} aria-label={label} data-tip={key ? `${label}   ${key}` : label}><Icon name={icon} /></button>
  );

  return (
    <div className={`app ${line ? 'is-line' : ''} ${selected && !onProfile ? 'has-reader' : ''} ${drawer ? 'drawer-open' : ''} ${compose ? 'composing' : ''} ${onProfile ? 'on-profile' : ''}`}>
      <aside className="side">
        <div className="side-top">
          <a className="logo-link" href="/caixa/inbox" aria-label={tr('mailbox.home')}
            onClick={e => { e.preventDefault(); navigate('/caixa/inbox'); setDrawer(false); }}><Logo /></a>
          <button className="icon-btn only-mobile" onClick={() => setDrawer(false)} aria-label={tr('mailbox.closeMenu')}><Icon name="x" /></button>
        </div>
        <button className="btn btn-quiet compose-btn" onClick={() => openCompose({ title: tr('mailbox.newMessage') })}>
          <Icon name="pen" />{tr('mailbox.compose')}
        </button>
        <nav className={`nav${dragging ? ' is-sorting' : ''}`}>
          {sortedFolders.map(f => (
            <a key={f.id} href={`/caixa/${f.id}`} aria-current={f.id === folder ? 'page' : undefined}
              className={dragging === f.id ? 'is-dragging' : undefined} {...handlers(f.id)}
              onClick={e => { e.preventDefault(); navigate(`/caixa/${f.id}`); setDrawer(false); }}>
              <Icon name={f.icon} />
              <span>{folderName(f.id)}</span>
              {f.id !== 'sent' && f.id !== 'trash' && !!counts[f.id] && <em>{counts[f.id]}</em>}
            </a>
          ))}
        </nav>
        <div className="side-foot" ref={footRef}>
          {usage && (
            <div className="side-usage" title={tr('mailbox.usage', { used: size(usage.used), total: size(usage.quota) })}>
              <div className="usage-bar"><i style={{ width: `${Math.min(100, Math.max(1, (usage.used / usage.quota) * 100))}%` }} /></div>
              <p>{rich(tr('mailbox.usageRich', { used: size(usage.used), total: size(usage.quota) }), { b: s => <span>{s}</span> })}</p>
            </div>
          )}
          <div className="popover-wrap">
            <button className="key-status" aria-expanded={pop === 'key'} onClick={() => setPop(pop === 'key' ? null : 'key')}>
              <Icon name="device" size={16} />{tr('mailbox.keyHere')}
            </button>
            {pop === 'key' && (
              <div className="popover" role="dialog">
                <div className="popover-note">
                  <strong>{tr('mailbox.keyTitle')}</strong>
                  <p>{tr('mailbox.keyText')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} />
      <AccountMenu user={user} avatarV={avatarV} onSettings={() => { navigate('/perfil'); setDrawer(false); }} onAgents={() => { navigate('/agentes-ia'); setDrawer(false); }} onSignOut={() => onSignOut()} />

      {onProfile && path === '/perfil/espaco' && <Storage session={session} onBack={() => navigate('/perfil')} />}
      {path === '/agentes-ia' && <AgentsPage address={user.address} onBack={() => navigate(`/caixa/${folder}`)} />}
      {path === '/conectar' && <ConnectCli onDone={() => navigate('/agentes-ia')} />}
      {onProfile && path === '/perfil' && (
        <Profile session={session} avatarV={avatarV} onUser={onUser} onAvatar={setAvatarV} onSignOut={() => onSignOut()} onIdle={setIdle}
          onBack={() => navigate(`/caixa/${folder}`)} />
      )}
      <section className="list">
        <div className="list-scroll" ref={listRef}>
          <header className="list-head">
            <div className="list-title">
              <button className="icon-btn only-mobile" onClick={() => setDrawer(true)} aria-label={tr('mailbox.openMenu')}><Icon name="menu" /></button>
              <h1>{folderName(folder)}</h1>
              {!!counts[folder] && folder !== 'sent' && <span className="muted">{tn('mailbox.unread', counts[folder]!)}</span>}
            </div>
            <label className="search">
              <Icon name="search" size={17} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tr('mailbox.searchIn', { folder: folderName(folder) })} spellCheck={false} />
              {query && <button className="icon-btn" onClick={() => setQuery('')} aria-label={tr('mailbox.clearSearch')}><Icon name="x" size={14} /></button>}
            </label>
            {wide && (
              <button className="icon-btn layout-toggle tip-end" onClick={toggleLayout}
                aria-label={tr(line ? 'mailbox.layoutCols' : 'mailbox.layoutLine')} data-tip={tr(line ? 'mailbox.layoutCols' : 'mailbox.layoutLine')}>
                <Icon name={line ? 'columns' : 'rows'} />
              </button>
            )}
            {line && (
              <div className="list-tools" role="toolbar" aria-label={tr('mailbox.selection')}>
                <CheckBox checked={allChecked} mixed={!allChecked && sel.length > 0} disabled={!visible.length}
                  label={tr(allChecked ? 'mailbox.unselectAll' : 'mailbox.selectAll')}
                  onToggle={() => setChecked(allChecked ? new Set() : new Set(visible.map(t => t.key)))} />
                {sel.length ? (
                  <>
                    <span className="tools-count">{tn('mailbox.selected', sel.length)}</span>
                    <span className="tools-actions">
                      {folder === 'spam' ? tool('inbox', tr('mailbox.notSpam'), () => bulk('notspam'))
                        : folder === 'trash' ? tool('undo', tr('mailbox.untrash'), () => bulk('restore'))
                        : folder === 'archive' ? tool('inbox', tr('mailbox.toInbox'), () => bulk('inbox'), 'E')
                        : tool('archive', tr('mailbox.archive'), () => bulk('archive'), 'E')}
                      {folder !== 'spam' && folder !== 'trash' ? tool('trash', tr('mailbox.delete'), () => bulk('trash'), '#')
                        : confirmForever ? (
                          // Apagar de vez não tem volta: o segundo clique confirma.
                          <button className="tools-confirm" onClick={() => bulk('forever')}>
                            {tn('mailbox.confirmForever', sel.length)}
                          </button>
                        )
                        : tool('trash', tr('mailbox.deleteForever'), () => setConfirmForever(true))}
                      {folder !== 'spam' && folder !== 'trash' && folder !== 'sent' && tool('spam', tr('mailbox.toSpam'), () => bulk('spam'))}
                      {sel.some(t => t.unread)
                        ? tool('read', tr('mailbox.markRead'), () => bulk('read'))
                        : tool('unread', tr('mailbox.markUnread'), () => bulk('unread'))}
                    </span>
                  </>
                ) : !!counts[folder] && folder !== 'sent' && (
                  <span className="tools-count is-quiet">{tn('mailbox.unread', counts[folder]!)}</span>
                )}
              </div>
            )}
          </header>

          {loading && !items.length && (
            <div className="rows-skeleton">{Array.from({ length: 7 }, (_, i) => <div key={i} className="row-skel" />)}</div>
          )}
          {error && <p className="form-error list-error"><Icon name="alert" size={16} />{error}</p>}
          {!loading && !error && visible.length === 0 && (
            <div className={`empty ${calm ? 'is-calm' : ''}`}>
              {query ? <Icon name="search" size={22} /> : folder === 'inbox' ? <EmptyFlight /> : folder === 'spam' ? <EmptyShield /> : <Icon name={current.icon} size={22} />}
              <p>{query ? tr(more ? 'common.loading' : 'mailbox.noResults') : tr(`mailbox.empty.${folder}`)}</p>
              {!query && (folder === 'inbox' || folder === 'spam') && <span className="muted small">{tr(`mailbox.hint.${folder}`)}</span>}
              {query && <span className="muted small">{tr('mailbox.searchNote')}</span>}
            </div>
          )}
          <ul className="rows">
            {visible.map((t, index) => {
              const last = t.latest;
              const outbound = (folder === 'sent' || folder === 'drafts') && t.items.every(i => i.folder === folder);
              const who = outbound
                ? (folder === 'drafts' && !last.h.to.length ? tr('mailbox.draft') : tr('common.toNames', { names: last.h.to.map(p => displayName(p)).join(', ') || '...' }))
                : participants(t);
              const sealed = t.items.some(i => i.sealedEnd && !i.spoofed);
              const spoofed = t.items.some(i => i.spoofed);
              // Rosto da conversa: quem escreveu por último (ou para quem foi, em Enviados). Foto só de
              // remetente confirmado; remetente falso com endereço Shalom fica nas iniciais.
              const sentOnly = t.items.every(i => i.folder === 'sent' || i.folder === 'drafts');
              const lastIn = [...t.items].reverse().find(i => i.folder !== 'sent');
              const face = sentOnly ? last.h.to[0] ?? null : lastIn?.h.from ?? null;
              const trusted = sentOnly || (!!lastIn && !lastIn.spoofed && (lastIn.sealedEnd || lastIn.h.auth === 'pass'));
              const subject = cleanSubject(t.items[0].h.subject) || tr('common.noSubject');
              const snippet = last.folder === 'sent' && t.items.length > 1 ? tr('common.youSaid', { text: last.h.snippet }) : last.h.snippet;
              const clip = t.items.some(i => i.h.attachments > 0);
              // Em linha: marcar, favoritar e o resto da linha abre a conversa. Sem arrasto e sem rosto.
              if (line) {
                const on = checked.has(t.key);
                return (
                  <li key={t.key} style={{ '--i': index } as CSSProperties} className={leaving.has(t.key) ? 'is-leaving' : ''}>
                    <div className={`lrow ${t.unread ? 'is-unread' : ''} ${on ? 'is-checked' : ''}`} data-key={t.key}>
                      <CheckBox checked={on} label={tr('mailbox.selectThread', { who })} onToggle={e => toggleCheck(t, e.shiftKey)} />
                      <button className="lrow-star" onClick={() => act('star', t)} aria-pressed={t.starred}
                        aria-label={tr(t.starred ? 'mailbox.unstar' : 'mailbox.star')}>
                        <Icon name="star" size={16} />
                      </button>
                      <button className="lrow-open" onClick={() => open(t)}>
                        <span className="lrow-who">
                          <span className="lrow-name" dir="auto">{who}</span>
                          {t.items.length > 1 && <span className="lrow-count">{t.items.length}</span>}
                          {sealed && !spoofed && <Icon name="shield" size={13} className="row-sealed" />}
                          {spoofed && <Icon name="alert" size={13} className="row-warn" />}
                        </span>
                        {/* Assunto e resumo isolados um do outro; a linha segue a direção do assunto (o
                            dir="auto" não enxerga dentro de <bdi> e cairia sempre na esquerda para a direita). */}
                        <span className="lrow-text" dir={textDir(subject || snippet)}>
                          <bdi className="lrow-subject">{subject}</bdi>
                          {(snippet || clip) && <span className="lrow-sep"> - </span>}
                          {clip && <Icon name="clip" size={13} />}
                          <bdi>{snippet}</bdi>
                        </span>
                        <span className="lrow-end">
                          {t.pinned ? <Icon name="pin" size={14} className="lrow-pin" /> : null}
                          <time dateTime={last.h.date} title={fullDate(last.h.date)}>{shortDate(last.h.date)}</time>
                        </span>
                      </button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={t.key} style={{ '--i': index } as CSSProperties} className={leaving.has(t.key) ? 'is-leaving' : ''}>
                  <SwipeRow
                    left={{ label: tr(t.pinned ? 'mailbox.unpin' : 'mailbox.pin'), icon: 'pin', tone: 'accent', run: () => act('pin', t) }}
                    right={folder === 'trash'
                      ? [{ label: tr('mailbox.restore'), icon: 'undo', run: () => act('restore', t) }, { label: tr('mailbox.delete'), icon: 'trash', tone: 'danger', run: () => act('forever', t) }]
                      : folder === 'spam'
                      ? [{ label: tr('mailbox.notSpam'), icon: 'inbox', run: () => act('notspam', t) }, { label: tr('mailbox.delete'), icon: 'trash', tone: 'danger', run: () => act('forever', t) }]
                      : [
                        folder === 'archive'
                          ? { label: folderName('inbox'), icon: 'inbox', run: () => act('inbox', t) }
                          : { label: tr('mailbox.archive'), icon: 'archive', run: () => act('archive', t) },
                        { label: tr('mailbox.delete'), icon: 'trash', tone: 'danger', run: () => act('trash', t) },
                      ]}
                  >
                    <button className={`row ${t.unread ? 'is-unread' : ''} ${selected?.key === t.key ? 'is-active' : ''}`} onClick={() => open(t)}>
                      <Avatar address={trusted ? face?.address : null} label={initials(face)} className="avatar row-avatar" />
                      <span className="row-main">
                        <span className="row-top">
                          <span className="row-who" dir="auto">{who}</span>
                          {t.items.length > 1 && <span className="row-count">{t.items.length}</span>}
                          {sealed && !spoofed && <Icon name="shield" size={13} className="row-sealed" />}
                          {spoofed && <Icon name="alert" size={13} className="row-warn" />}
                          <time>{shortDate(last.h.date)}</time>
                        </span>
                        <span className="row-subject" dir="auto">{subject}</span>
                        <span className="row-snippet" dir={textDir(snippet)}>
                          {clip && <Icon name="clip" size={13} />}
                          {snippet}
                        </span>
                      </span>
                      {t.pinned ? <Icon name="pin" size={14} className="row-pin" /> : null}
                      {t.starred ? <Icon name="star" size={14} className="row-star" /> : null}
                    </button>
                  </SwipeRow>
                </li>
              );
            })}
          </ul>
          {more && <button className="btn btn-quiet load-more" onClick={loadMore}>{tr('common.loadMore')}</button>}
        </div>
      </section>

      <main className="read">
        {selected
          ? (
            <Reader thread={selected} focusId={id!} secretKey={secretKey} onAction={act} onBack={closeReader}
              reply={inline?.key === selected.key ? (
                <Composer key={inline.seed.title + inline.key} session={session} seed={inline.seed} inline
                  onClose={() => setInline(null)}
                  onSent={(msg, sealed) => { setInline(null); showToast({ text: msg, sealed }); refresh(true); }} />
              ) : null} />
          )
          : (
            <div className="read-empty">
              <p>{tr('mailbox.noneOpen')}</p>
              <span>{tr('mailbox.noneOpenNote')}</span>
            </div>
          )}
      </main>

      {compose && (
        <Composer session={session} seed={compose} leaving={composeLeaving} onClose={() => closeCompose()}
          onSent={(msg, sealed) => closeCompose(() => { showToast({ text: msg, sealed }); refresh(true); })} />
      )}

      <button className="btn btn-primary fab" onClick={() => openCompose({ title: tr('mailbox.newMessage') })}>
        <Icon name="pen" />{tr('mailbox.compose')}
      </button>

      {toast && (
        <div className={`toast ${toast.leaving ? 'is-leaving' : ''}`} role="status">
          {toast.sealed && <Icon name="shield" size={16} />}
          <span>{toast.text}</span>
          {toast.undo && <button onClick={toast.undo}>{tr('common.undo')}</button>}
        </div>
      )}
    </div>
  );
}
