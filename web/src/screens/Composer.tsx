import type { Email } from 'postal-mime';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Person } from '../../../shared/head';
import { contactsFor, suggest, type Book, type Contact } from '../lib/contacts';
import { initials, size } from '../lib/format';
import { finalize, isImage, MAX_FILES, MAX_TOTAL, pending, totalSize, type Pending } from '../lib/attach';
import { trustNewKey } from '../lib/pins';
import { prepare, srcdoc } from '../lib/render';
import { deleteDraft, isShalom, KeyChanged, publicKeyOf, saveDraft, sendMessage, type Outgoing } from '../lib/send';
import type { Attachment } from '../lib/mime';
import type { Session } from '../lib/session';
import { currentTheme } from '../lib/theme';
import { Editor, type EditorHandle } from '../ui/Editor';
import { Icon, type IconName } from '../ui/Icon';
import { t as tr, tn } from '../i18n';
import './composer.css';

export type ComposeSeed = {
  title: string;
  // O que a janela é (o ícone sai daqui) e de quem é a mensagem que vai junto.
  mode?: 'reply' | 'replyAll' | 'forward';
  quotedFrom?: string;
  to?: Person[]; cc?: Person[]; bcc?: Person[];
  subject?: string;
  quoted?: Outgoing['quoted'];
  inReplyTo?: string; references?: string;
  // Reaberto da pasta Rascunhos: o texto (com as fotos já em blob:) e os anexos.
  draft?: { id: string; html: string; files: Pending[] };
};

type Chip = Person & { state: 'checking' | 'sealed' | 'plain' | 'missing' | 'invalid' };

const EMAIL = /^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// "Nome <email>" ou só o e-mail.
function parsePerson(raw: string): Person | null {
  const s = raw.trim().replace(/[,;]$/, '');
  const m = /^(.*)<([^>]+)>$/.exec(s);
  const address = (m ? m[2] : s).trim().toLowerCase();
  const name = m ? m[1].trim().replace(/^"|"$/g, '') : '';
  return address ? { name, address } : null;
}

const chipTitle = (state: Chip['state']) => tr(`composer.chip.${state}`);

function RecipientField({ label, chips, onChange, autoFocus, book, taken }: {
  label: string; chips: Chip[]; onChange: (c: Chip[]) => void; autoFocus?: boolean;
  // Agenda deste aparelho e endereços que já estão em algum campo.
  book: Book; taken: Set<string>;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  // Esc fecha as sugestões até a pessoa digitar de novo.
  const [hidden, setHidden] = useState(false);
  // Sugestão marcada pelas setas (ou pelo mouse) para o texto atual.
  const [pick, setPick] = useState<{ text: string; i: number } | null>(null);
  const [up, setUp] = useState(false);
  const latest = useRef(chips);
  latest.current = chips;
  // O blur lê daqui, não do estado: escolher com Tab limpa o texto antes de o foco sair.
  const typed = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const setTyped = (v: string) => { typed.current = v; setText(v); setHidden(false); };

  const matches = useMemo(() => suggest(book, text, taken), [book, text, taken]);
  const open = focused && !hidden && matches.length > 0;
  // A primeira vem marcada, salvo quando o texto já é um endereço completo que não é o dela.
  const t = text.trim().toLowerCase();
  const first = matches.length && !(EMAIL.test(t) && matches[0].address !== t) ? 0 : -1;
  const active = pick?.text === text && pick.i < matches.length ? pick.i : first;

  // Sem espaço embaixo (resposta no fim da conversa, teclado aberto), a lista abre para cima.
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    const r = input.current.getBoundingClientRect();
    const h = window.visualViewport?.height ?? window.innerHeight;
    const need = matches.length * 52 + 48;
    setUp(h - r.bottom < need && r.top > h - r.bottom);
  }, [open, matches.length]);

  function addPerson(p: Person | null) {
    if (!p || latest.current.some(c => c.address === p.address)) { setTyped(''); return; }
    const valid = EMAIL.test(p.address);
    const chip: Chip = { ...p, state: !valid ? 'invalid' : isShalom(p.address) ? 'checking' : 'plain' };
    onChange([...latest.current, chip]);
    setTyped('');
    if (chip.state === 'checking') {
      publicKeyOf(p.address).then(key => {
        onChange(latest.current.map(c => (c.address === p.address ? { ...c, state: key ? 'sealed' : 'missing' } : c)));
      }).catch(() => onChange(latest.current.map(c => (c.address === p.address ? { ...c, state: 'missing' } : c))));
    }
  }

  const choose = (c: Contact) => addPerson({ name: c.name, address: c.address });

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    const sug = open && active >= 0 ? matches[active] : null;
    if (e.key === 'ArrowDown' && hidden && matches.length) { e.preventDefault(); setHidden(false); return; }
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = matches.length;
      setPick({ text, i: e.key === 'ArrowDown' ? (active + 1) % n : active <= 0 ? n - 1 : active - 1 });
      return;
    }
    // Esc fecha só a lista; o composer continua aberto.
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setHidden(true); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && sug) { if (e.key === 'Enter') e.preventDefault(); choose(sug); return; }
    if ((e.key === ',' || e.key === ';') && sug && !t.includes('@')) { e.preventDefault(); choose(sug); return; }
    // Com sugestões na tela, espaço continua a busca pelo nome ("lia mo").
    if (e.key === ' ' && open && !t.includes('@')) return;
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ' || e.key === 'Tab') && text.trim()) {
      if (e.key !== 'Tab') e.preventDefault();
      addPerson(parsePerson(text));
    } else if (e.key === 'Backspace' && !text && chips.length) {
      onChange(chips.slice(0, -1));
    }
  }

  return (
    <div className="rcpt">
      <span className="rcpt-label">{label}</span>
      <div className="rcpt-box" onClick={e => { if (e.target === e.currentTarget) input.current?.focus(); }}>
        {chips.map(c => (
          <span key={c.address} className={`chip chip-${c.state}`} title={`${c.name ? `${c.name} <${c.address}>` : c.address}\n${chipTitle(c.state)}`}>
            {c.state === 'sealed' && <Icon name="lock" size={13} />}
            {(c.state === 'missing' || c.state === 'invalid') && <Icon name="alert" size={13} />}
            <span className="chip-text">{c.name || c.address}</span>
            <button type="button" onClick={() => onChange(chips.filter(x => x.address !== c.address))} aria-label={tr('composer.removeChip', { address: c.address })}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input ref={input} value={text} onChange={e => setTyped(e.target.value)} onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (typed.current.trim()) addPerson(parsePerson(typed.current)); }}
          autoFocus={autoFocus} type="text" inputMode="email" dir="ltr" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} />
      </div>
      {open && (
        // Clicar na lista não tira o foco do campo (senão o texto pela metade viraria endereço).
        <div className={`sug ${up ? 'is-up' : ''}`} onMouseDown={e => e.preventDefault()} onPointerDown={e => e.preventDefault()}>
          <ul role="listbox" id={listId} aria-label={tr('composer.suggestionsFor', { label })}>
            {matches.map((c, i) => (
              <li key={c.address} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''}
                onMouseMove={() => { if (i !== active) setPick({ text, i }); }} onClick={() => choose(c)}>
                <span className="avatar sug-avatar">{initials(c)}</span>
                <span className="sug-text">
                  <span className="sug-name">{c.name || c.address}</span>
                  {c.name && <span className="sug-addr">{c.address}</span>}
                </span>
                {isShalom(c.address) && <span className="sug-lock" title={chipTitle('sealed')}><Icon name="lock" size={14} /></span>}
              </li>
            ))}
          </ul>
          <p className="sug-note">{tr('composer.sugNote')}</p>
        </div>
      )}
    </div>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(currentTheme());
  useEffect(() => {
    const on = () => setTheme(currentTheme());
    window.addEventListener('shalom:theme', on);
    return () => window.removeEventListener('shalom:theme', on);
  }, []);
  return theme;
}

// A mensagem que vai junto (resposta ou encaminhamento). Fechada por padrão; aberta, mostra o que
// vai de fato, limpo pelo mesmo caminho da leitura e num iframe sem script.
function Quoted({ quoted, forward, who }: { quoted: NonNullable<Outgoing['quoted']>; forward: boolean; who: string }) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const prepared = useMemo(() => prepare({ html: quoted.html, text: '', attachments: [] } as unknown as Email), [quoted.html]);
  // Texto puro chega como HTML com <br>; só e-mail em HTML de verdade tem as cores invertidas no escuro.
  const rich = useMemo(() => /<(?!br\s*\/?>)[a-z]/i.test(quoted.html), [quoted.html]);
  const snippet = useMemo(() => {
    const b = prepared.doc.body.cloneNode(true) as HTMLElement;
    b.querySelectorAll('style, script, title').forEach(n => n.remove());
    return (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }, [prepared]);
  const doc = useMemo(() => (open ? srcdoc(prepared, { dark: theme === 'dark', rich, noLinks: true }) : ''), [open, prepared, theme, rich]);

  // Altura do iframe acompanha o conteúdo, medida daqui de fora.
  useEffect(() => {
    const f = frame.current;
    if (!f || !doc) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const body = f.contentDocument?.body;
      if (body) f.style.height = `${Math.max(Math.ceil(body.getBoundingClientRect().height), 40)}px`;
    };
    const onLoad = () => {
      fit();
      f.classList.add('is-ready');
      const body = f.contentDocument?.body;
      if (body) { ro = new ResizeObserver(() => requestAnimationFrame(fit)); ro.observe(body); }
    };
    f.addEventListener('load', onLoad);
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [doc]);

  const title = who ? tr('composer.quotedFrom', { name: who }) : tr(forward ? 'composer.quotedFwd' : 'composer.quotedPrev');
  return (
    <div className={`cq ${open ? 'is-open' : ''}`}>
      <button type="button" className="cq-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="cq-icon"><Icon name={forward ? 'forward' : 'reply'} size={16} /></span>
        <span className="cq-text">
          <strong>{title}</strong>
          {!open && <span dir="auto">{snippet || tr('composer.below')}</span>}
        </span>
        <span className="cq-more"><span>{tr(open ? 'common.hide' : 'common.show')}</span><Icon name="back" size={14} className="cq-chev" /></span>
      </button>
      {open && (
        <div className="cq-body">
          <p className="cq-head">{quoted.header}</p>
          {/* Sem allow-scripts: o que vai junto só é mostrado, nunca roda. */}
          <iframe ref={frame} title={title} sandbox="allow-same-origin" srcDoc={doc} referrerPolicy="no-referrer" />
        </div>
      )}
    </div>
  );
}

const toChips = (list: Person[] = []): Chip[] => list.map(p => ({ ...p, state: isShalom(p.address) ? 'checking' : 'plain' }));

const modeIcon = (mode: ComposeSeed['mode'], quoted: boolean): IconName =>
  mode === 'forward' ? 'forward' : mode === 'replyAll' ? 'replyAll' : quoted ? 'reply' : 'pen';

export function Composer({ session, seed, leaving, inline, onClose, onSent }: { session: Session; seed: ComposeSeed; leaving?: boolean; inline?: boolean; onClose: () => void; onSent: (msg: string, sealed: boolean) => void }) {
  const [to, setTo] = useState<Chip[]>(() => toChips(seed.to));
  const [cc, setCc] = useState<Chip[]>(() => toChips(seed.cc));
  const [bcc, setBcc] = useState<Chip[]>(() => toChips(seed.bcc));
  const [showCc, setShowCc] = useState(!!seed.cc?.length || !!seed.bcc?.length);
  const [subject, setSubject] = useState(seed.subject ?? '');
  // O texto mora no editor; "typed" só avisa que algo mudou (para o descartar e o rascunho).
  const [typed, setTyped] = useState(0);
  const [files, setFiles] = useState<Pending[]>(() => seed.draft?.files ?? []);
  const filesRef = useRef(files);
  filesRef.current = files;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keyChange, setKeyChange] = useState<KeyChanged | null>(null);
  const body = useRef<EditorHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const mode = modeIcon(seed.mode, !!seed.quoted);
  const forward = mode === 'forward';

  // Agenda só deste aparelho, tirada das mensagens já abertas. Nenhum pedido ao servidor.
  const book = useMemo(() => contactsFor(session.user.address), [session.user.address]);

  // Destinatários que vieram prontos (responder) também são conferidos.
  useEffect(() => {
    // Cada resposta atualiza a lista do momento (não a do começo), senão a última apagaria as outras.
    const check = (list: Chip[], set: (f: (c: Chip[]) => Chip[]) => void) => {
      list.filter(c => c.state === 'checking').forEach(c => {
        publicKeyOf(c.address).then(key => set(now => now.map(x => (x.address === c.address && x.state === 'checking' ? { ...x, state: key ? 'sealed' : 'missing' } : x))));
      });
    };
    check(to, setTo);
    check(cc, setCc);
    check(bcc, setBcc);
    if (seed.draft) body.current?.setHtml(seed.draft.html);
    if (seed.to?.length) body.current?.focus();
    // Dentro da conversa, a caixa inteira entra na tela, com o Enviar à vista.
    if (inline) requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = [...to, ...cc, ...bcc];
  const taken = useMemo(() => new Set([...to, ...cc, ...bcc].map(c => c.address)), [to, cc, bcc]);
  const blocked = all.find(c => c.state === 'missing' || c.state === 'invalid' || c.state === 'checking');
  const bad = all.find(c => c.state === 'missing' || c.state === 'invalid');
  const checking = all.some(c => c.state === 'checking');
  const external = all.filter(c => c.state === 'plain').length;
  const allSealed = all.length > 0 && all.every(c => c.state === 'sealed');

  // Foto colada ou arrastada entra no texto; arquivo (ou foto pelo clipe) vira anexo embaixo.
  function addFiles(list: File[], inline: boolean) {
    const next: Pending[] = [];
    for (const f of list) {
      const p = pending(f, inline && isImage(f));
      if (p.inline) body.current?.insertImage(p.url);
      next.push(p);
    }
    setFiles(prev => [...prev, ...next].slice(0, MAX_FILES + 5));
    setError('');
  }
  function removeFile(id: string) {
    setFiles(prev => prev.filter(p => { if (p.id === id && p.url) URL.revokeObjectURL(p.url); return p.id !== id; }));
  }
  useEffect(() => () => { for (const p of filesRef.current) if (p.url) URL.revokeObjectURL(p.url); }, []);

  // Foto comprimida uma vez só por destino (WebP entre contas Shalom, JPEG para fora), mesmo que o
  // rascunho se salve várias vezes.
  const prepared = useRef(new Map<string, Attachment>());
  async function prep(list: Pending[], external: boolean) {
    const out: Attachment[] = [];
    for (const p of list) {
      const key = `${p.id}:${external ? 'out' : 'in'}`;
      let a = prepared.current.get(key);
      if (!a) { [a] = await finalize([p], external); prepared.current.set(key, a); }
      out.push(a);
    }
    return out;
  }
  // HTML do editor com cid: no lugar das fotos que continuam no texto, e a lista do que vai junto.
  function snapshot() {
    const cids = new Map(files.filter(p => p.inline).map(p => [p.url, `${p.id}@shalomail.com`]));
    const used = new Set<string>();
    const html = body.current?.html(url => { const c = cids.get(url); if (c) used.add(url); return c ?? null; }) ?? '';
    return { html, keep: files.filter(p => !p.inline || used.has(p.url)) };
  }

  // Rascunho: salva sozinho numa pausa da escrita, trancado com a sua chave. Sai quando envia ou descarta.
  const draftId = useRef(seed.draft?.id);
  const saving = useRef<Promise<void> | null>(null);
  const [draftState, setDraftState] = useState<'idle' | 'saved'>(seed.draft ? 'saved' : 'idle');
  const gone = useRef(false);
  async function saveNow() {
    if (gone.current) return;
    if (saving.current) await saving.current;
    const run = (async () => {
      const strip = (l: Chip[]) => l.map(({ name, address }) => ({ name, address }));
      const { html, keep } = snapshot();
      const attachments = await prep(keep, false);
      if (totalSize(attachments) > MAX_TOTAL * 2) return;
      try {
        draftId.current = await saveDraft(session, {
          to: strip(to), cc: strip(cc), bcc: strip(bcc), subject: subject.trim(), text: body.current?.text() ?? '', html, attachments,
          inReplyTo: seed.inReplyTo, references: seed.references,
        }, draftId.current);
        if (!gone.current) setDraftState('saved');
      } catch { /* sem rede: tenta de novo na próxima pausa */ }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }

  async function send() {
    if (!all.length) { setError(tr('composer.needRecipient')); return; }
    if (blocked) { setError(blocked.state === 'checking' ? tr('composer.stillChecking') : tr('composer.checkAddress', { address: blocked.address })); return; }
    setBusy(true);
    setError('');
    try {
      // Foto do texto que a pessoa apagou não vai junto; a que ficou vira cid: no HTML.
      const { html, keep } = snapshot();
      if (keep.length > MAX_FILES) throw new Error(tr('composer.tooMany', { max: MAX_FILES }));
      const attachments = await prep(keep, external > 0);
      if (totalSize(attachments) > MAX_TOTAL) throw new Error(tr('composer.tooBig', { max: size(MAX_TOTAL) }));
      const strip = (l: Chip[]) => l.map(({ name, address }) => ({ name, address }));
      await sendMessage(session, {
        to: strip(to), cc: strip(cc), bcc: strip(bcc),
        subject: subject.trim(), text: body.current?.text() ?? '', html, attachments,
        quoted: seed.quoted, inReplyTo: seed.inReplyTo, references: seed.references,
      });
      gone.current = true;
      if (saving.current) await saving.current.catch(() => {});
      if (draftId.current) deleteDraft(draftId.current);
      onSent(tr(allSealed ? 'composer.sentSealed' : 'composer.sent'), allSealed);
    } catch (e) {
      if (e instanceof KeyChanged) setKeyChange(e);
      else setError(e instanceof Error ? e.message : tr('composer.sendFail'));
      setBusy(false);
    }
  }

  async function trustAndSend() {
    if (!keyChange) return;
    await trustNewKey(session.user.id, keyChange.address, keyChange.newKey);
    setKeyChange(null);
    send();
  }

  // Fechar (X ou Esc) guarda o rascunho; a lixeira pergunta antes de jogar fora.
  const [askDiscard, setAskDiscard] = useState(false);
  void typed;
  const dirty = !(body.current?.empty() ?? true) || files.length > 0 || subject !== (seed.subject ?? '') || bcc.length > 0
    || to.length !== (seed.to?.length ?? 0) || cc.length !== (seed.cc?.length ?? 0);
  const tryClose = () => { if (dirty && !askDiscard) setAskDiscard(true); else discard(); };
  async function keepAndClose() {
    if (dirty) await saveNow();
    gone.current = true;
    onClose();
  }
  function discard() {
    gone.current = true;
    if (draftId.current) deleteDraft(draftId.current);
    onClose();
  }
  const bump = useCallback(() => setTyped(n => n + 1), []);
  // Saiu da tela sem fechar (outra conversa, outra pasta): guarda o que ficou por salvar.
  const lastSave = useRef(saveNow);
  lastSave.current = saveNow;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => () => { if (dirtyRef.current && !gone.current) lastSave.current(); }, []);
  // Salva 2,5 s depois da última mudança, só se há algo escrito.
  useEffect(() => {
    if (!dirty || gone.current) return;
    setDraftState('idle');
    const t = window.setTimeout(() => { saveNow(); }, 2500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, subject, to, cc, bcc, files]);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { e.preventDefault(); if (askDiscard) setAskDiscard(false); else keepAndClose(); }
  }

  // Como vai sair: verde quando todos têm conta Shalom; senão, diz que vai como e-mail comum.
  let seal: ReactNode = null;
  if (bad) {
    seal = <><Icon name="alert" size={15} />{tr(bad.state === 'missing' ? 'composer.noAccountWith' : 'composer.invalidAddr', { address: bad.address })}</>;
  } else if (!checking && allSealed) {
    seal = <><Icon name="shield" size={15} />{tr('composer.sealed')}</>;
  } else if (!checking && external > 0) {
    seal = <><Icon name="unread" size={15} />{external === all.length
      ? tr('composer.allPlain')
      : tn('composer.somePlain', external)}</>;
  }

  return (
    <div ref={root} className={`composer ${inline ? 'composer-inline' : ''} ${leaving ? 'is-leaving' : ''}`} role={inline ? 'region' : 'dialog'} aria-label={seed.title} onKeyDown={onKey}>
      <header className="composer-head">
        {inline
          ? <span className="composer-mode"><Icon name={mode} size={16} />{seed.title}</span>
          : <span>{seed.title}</span>}
        {draftState === 'saved' && <span className="composer-draft" aria-live="polite">{tr('composer.draftSaved')}</span>}
        {!inline && <button className="icon-btn" onClick={keepAndClose} aria-label={tr('common.close')}><Icon name="x" /></button>}
        {/* No celular o Enviar fica aqui em cima, longe do teclado. */}
        {!inline && <button className="btn btn-primary composer-send-top" onClick={send} disabled={busy}>{busy ? <span className="spinner" /> : tr('composer.send')}</button>}
      </header>
      <div className="composer-fields">
        <div className="rcpt-row">
          <RecipientField label={tr('composer.to')} chips={to} onChange={setTo} autoFocus={!seed.to?.length} book={book} taken={taken} />
          {!showCc && <button className="cc-toggle" onClick={() => setShowCc(true)}>{tr('composer.ccBcc')}</button>}
        </div>
        {showCc && <RecipientField label={tr('composer.cc')} chips={cc} onChange={setCc} book={book} taken={taken} />}
        {showCc && <RecipientField label={tr('composer.bcc')} chips={bcc} onChange={setBcc} book={book} taken={taken} />}
        {/* Na resposta o assunto vem pronto ("Re: ..."); só a mensagem nova pede assunto. */}
        {!inline && <input className="composer-subject" placeholder={tr('composer.subject')} value={subject} onChange={e => setSubject(e.target.value)} maxLength={300} />}
      </div>
      <Editor ref={body} label={tr('composer.message')} compact={inline} onInput={bump} onFiles={addFiles}
        placeholder={tr(forward ? 'composer.fwdPlaceholder' : inline ? 'composer.replyPlaceholder' : 'composer.newPlaceholder')} />
      {files.some(p => !p.inline) && (
        <ul className="composer-files">
          {files.filter(p => !p.inline).map(p => (
            <li key={p.id}>
              {p.url ? <img src={p.url} alt="" /> : <span className="composer-file-icon"><Icon name="clip" size={15} /></span>}
              <span className="composer-file-name">{p.file.name}</span>
              <span className="muted small">{size(p.file.size)}</span>
              <button type="button" onClick={() => removeFile(p.id)} aria-label={tr('composer.removeAttach', { name: p.file.name })}><Icon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {seed.quoted && <Quoted quoted={seed.quoted} forward={forward} who={seed.quotedFrom ?? ''} />}
      {error && <p className="form-error composer-error"><Icon name="alert" size={16} />{error}</p>}
      {keyChange && (
        <div className="key-change" role="alert">
          <p><Icon name="alert" size={16} /><strong>{tr('composer.keyTitle', { address: keyChange.address })}</strong></p>
          <p className="muted small">{tr('composer.keyText')}</p>
          <dl>
            <dt>{tr('composer.before')}</dt><dd dir="ltr">{keyChange.before}</dd>
            <dt>{tr('composer.now')}</dt><dd dir="ltr">{keyChange.after}</dd>
          </dl>
          <div className="key-change-actions">
            <button className="btn btn-quiet" onClick={() => setKeyChange(null)}>{tr('composer.dontSend')}</button>
            <button className="btn btn-primary" onClick={trustAndSend}>{tr('composer.trust')}</button>
          </div>
        </div>
      )}
      <footer className="composer-foot">
        {!askDiscard && <button className="btn btn-primary" onClick={send} disabled={busy}>
          {busy ? <><span className="spinner" />{tr('composer.sealing')}</> : <>{tr('composer.send')}<Icon name="send" size={16} /></>}
        </button>}
        {askDiscard ? (
          <span className="composer-discard" role="alert">
            <span>{tr('composer.discardAsk')}</span>
            <button className="btn btn-quiet" onClick={() => setAskDiscard(false)} autoFocus>{tr('composer.keepWriting')}</button>
            <button className="btn composer-discard-go" onClick={discard}>{tr('composer.discard')}</button>
          </span>
        ) : <>
          <span className={`composer-seal ${allSealed && !bad ? 'is-sealed' : ''} ${bad ? 'is-warn' : ''}`} aria-live="polite">{seal}</span>
          <button className="icon-btn tip-up tip-end" onClick={tryClose} aria-label={tr('composer.discard')} data-tip={tr('composer.discard')}><Icon name="trash" /></button>
        </>}
      </footer>
    </div>
  );
}
