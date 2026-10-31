import type { Email } from 'postal-mime';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { people, type Person } from '../../../shared/head';
import { displayName, fullDate, initials, readerDate, shortDate, size } from '../lib/format';
import { cleanSubject, confirmIdentity, identityOf, readMessage, type Item, type Thread } from '../lib/mailbox';
import { attachmentsOf, downloadAttachment, imageTypeOf, loadRemoteImages, prepare, srcdoc } from '../lib/render';
import { currentTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { t, tn } from '../i18n';

export type ReaderAction = 'archive' | 'inbox' | 'trash' | 'restore' | 'forever' | 'unread' | 'star' | 'pin' | 'spam' | 'notspam' | 'reply' | 'replyAll' | 'forward';

const firstName = (p: Person | null) => displayName(p).split(/\s+/)[0];

// Mensagem de outra conta Shalom: fechada de ponta a ponta. A identidade de quem enviou vem do certificado
// do servidor e da chave fixada neste aparelho; só a impressão digital comparada com a pessoa, por fora do
// Shalom, garante que ninguém (nem o servidor) se passou por ela. A conferência fica guardada aqui.
function SealedLine({ item }: { item: Item }) {
  const incoming = item.folder !== 'sent' && !!item.sender && !!item.senderKey;
  const [id, setId] = useState<{ fingerprint: string; confirmed: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (incoming) identityOf(item.sender!, item.senderKey!).then(setId).catch(() => setId(null));
  }, [incoming, item.sender, item.senderKey]);
  const name = firstName(item.h.from);
  return (
    <>
      <p className="sec sec-safe">
        <Icon name="shield" size={16} />
        <span>
          <strong>{t('reader.e2e')}</strong> {item.folder === 'sent' || item.own ? t('reader.lockedHere') : t('reader.lockedThere', { name })}
          {id && (id.confirmed
            ? <span className="sec-id is-done"> <Icon name="check" size={13} />{t('reader.idDone')}</span>
            : <> <button type="button" className="sec-id-btn" onClick={() => setOpen(!open)} aria-expanded={open}>{t('reader.idCheck')}</button></>)}
        </span>
      </p>
      {open && id && !id.confirmed && (
        <div className="sec-id-panel" role="region" aria-label={t('reader.idTitle', { name })}>
          <p className="sec-id-title">{t('reader.idTitle', { name })}</p>
          <p className="sec-id-digits" dir="ltr">{id.fingerprint}</p>
          <p className="sec-id-how">{t('reader.idHow', { name })}</p>
          <div className="sec-id-actions">
            <button className="btn btn-quiet" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={async () => {
              if (await confirmIdentity(item.sender!, item.senderKey!)) setId({ ...id, confirmed: true });
              setOpen(false);
            }}>{t('reader.idConfirm')}</button>
          </div>
        </div>
      )}
    </>
  );
}

function SecurityLine({ item }: { item: Item }) {
  // Remetente falso: o aviso fica no próprio endereço do cabeçalho (em âmbar, com explicação no hover).
  if (item.spoofed) return null;
  if (item.sealedEnd) return <SealedLine item={item} />;
  // A sua cópia de algo que foi para fora do Shalom: sem linha nenhuma.
  if (item.folder === 'sent' || item.own) return null;
  if (item.folder === 'spam') {
    return <p className="sec sec-spam"><Icon name="spam" size={16} />{t('reader.spam')}</p>;
  }
  return <p className="sec"><Icon name="lock" size={16} />{t('reader.external')}</p>;
}

// "Para" com nome e endereço de cada um, como na linha de quem enviou.
function Recipients({ list }: { list: Person[] }) {
  if (!list.length) return <>{t('common.youInList')}</>;
  return (
    <>
      {list.map((p, i) => (
        <span key={p.address + i}>
          {i > 0 && ', '}
          {p.name ? <>{p.name} <span className="addr">{p.address}</span></> : <span className="addr">{p.address}</span>}
        </span>
      ))}
    </>
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

// Uma mensagem da conversa. Fechada mostra quem, a prévia e a hora; aberta mostra tudo.
function MessageCard({ item, expanded, onToggle, secretKey, isLast, onReply }: {
  item: Item;
  expanded: boolean;
  onToggle: () => void;
  secretKey: Uint8Array;
  isLast: boolean;
  onReply: (a: 'reply' | 'replyAll' | 'forward', item: Item, email: Email) => void;
}) {
  const theme = useTheme();
  const [email, setEmail] = useState<Email | null>(null);
  const [error, setError] = useState('');
  const [images, setImages] = useState<'blocked' | 'loading' | 'shown'>('blocked');
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!expanded || email) return;
    let gone = false;
    readMessage(item.id, secretKey, item)
      .then(e => { if (!gone) setEmail(e); })
      // A falha do AES-GCM chega sem mensagem: sem o texto de reserva, o leitor ficaria girando para sempre.
      .catch(err => { if (!gone) setError((err instanceof Error && err.message) || t('common.openFail')); });
    return () => { gone = true; };
  }, [expanded, item.id, secretKey, email]);

  const prepared = useMemo(() => (email ? prepare(email) : null), [email]);
  // Em mensagem Shalom, o From escrito dentro do e-mail também tem que ser quem enviou de fato.
  const innerFrom = email ? people(email.from)[0]?.address?.toLowerCase() : undefined;
  const shown = item.sender && innerFrom && innerFrom !== item.sender ? { ...item, spoofed: true } : item;
  const doc = useMemo(
    () => (prepared && email ? srcdoc(prepared, { dark: theme === 'dark', rich: !!email.html, noLinks: item.folder === 'spam' || item.spoofed }) : ''),
    // version muda quando as imagens remotas entram no documento
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prepared, version, theme],
  );

  // Altura do iframe acompanha o conteúdo, medindo o body daqui de fora (sem script dentro dele).
  useEffect(() => {
    const f = frame.current;
    if (!f || !doc) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const body = f.contentDocument?.body;
      if (body) f.style.height = `${Math.max(Math.ceil(body.getBoundingClientRect().height), 48)}px`;
    };
    const onLoad = () => {
      fit();
      setReady(true);
      const body = f.contentDocument?.body;
      if (body) { ro = new ResizeObserver(() => requestAnimationFrame(fit)); ro.observe(body); }
    };
    f.addEventListener('load', onLoad);
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [doc]);

  async function showImages() {
    if (!prepared) return;
    setImages('loading');
    await loadRemoteImages(prepared);
    setVersion(v => v + 1);
    setImages('shown');
  }

  const h = item.h;
  if (!expanded) {
    return (
      <button className="msg msg-collapsed" onClick={onToggle}>
        <span className="avatar">{initials(h.from)}</span>
        <span className="msg-collapsed-text">
          <strong>{item.folder === 'sent' ? t('common.youSender') : displayName(h.from)}</strong>
          <span dir="auto">{h.snippet}</span>
        </span>
        <time dateTime={h.date} title={fullDate(h.date)}>{shortDate(h.date)}</time>
      </button>
    );
  }

  const files = email ? attachmentsOf(email) : [];
  const others = email ? [...people(email.to), ...people(email.cc)] : h.to;

  return (
    <section className="msg">
      <div className="reader-from" onClick={isLast ? undefined : onToggle} role={isLast ? undefined : 'button'}>
        <span className="avatar avatar-lg">{initials(h.from)}</span>
        <div className="reader-from-text">
          <p>
            <strong>{displayName(h.from)}</strong>{' '}
            {shown.spoofed
              ? (
                <span className="warn-tip" tabIndex={0} onClick={e => e.stopPropagation()}>
                  <span className="is-warn">{h.from?.address}<Icon name="alert" size={14} /></span>
                  <span className="warn-bubble" role="tooltip">
                    {shown.sender ? (
                      <><strong>{t('reader.spoofTitle')}</strong>{t('reader.spoofText', { sender: item.sender ?? '' })}</>
                    ) : (
                      item.keyChanged
                        ? <><strong>{t('reader.keyTitle', { address: h.from?.address ?? '' })}</strong>{t('reader.keyText')}</>
                        : <><strong>{t('reader.unverifiedTitle')}</strong>{t('reader.unverifiedText', { address: h.from?.address ?? '' })}</>
                    )}
                  </span>
                </span>
              )
              : <span className="muted">{h.from?.address}</span>}
          </p>
          <p className="muted small">{t('reader.to')} <Recipients list={others} /></p>
        </div>
        <time dateTime={h.date} title={fullDate(h.date)}>{readerDate(h.date)}</time>
      </div>
      <SecurityLine item={shown} />

      {error && <p className="form-error"><Icon name="alert" size={16} />{error}</p>}
      {!email && !error && <div className="sheet-loading"><span className="spinner" />{t('reader.opening')}</div>}

      {email && prepared && (
        <>
          {prepared.remoteImages.length > 0 && images !== 'shown' && (
            <div className="images-note">
              <Icon name="image" size={16} />
              <span>{tn('reader.imagesBlocked', prepared.remoteImages.length)}</span>
              <button onClick={showImages} disabled={images === 'loading'}>{images === 'loading' ? t('common.loading') : t('reader.showImages')}</button>
            </div>
          )}
          <div className="sheet">
            {/* NUNCA adicionar allow-scripts aqui: junto com allow-same-origin ele desfaz o sandbox. */}
            <iframe
              ref={frame}
              className={ready ? 'is-ready' : ''}
              title={t('reader.messageFrom', { name: displayName(h.from) })}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              srcDoc={doc}
              referrerPolicy="no-referrer"
            />
          </div>
          {files.length > 0 && (
            <div className="files">
              {files.map((f, i) => <FileButton key={i} file={f} />)}
            </div>
          )}
          {isLast && (
            <div className="reply-row">
              <button className="btn btn-quiet" onClick={() => onReply('reply', item, email)}><Icon name="reply" />{t('mailbox.reply')}</button>
              {others.length > 1 && (
                <button className="btn btn-quiet" onClick={() => onReply('replyAll', item, email)}><Icon name="replyAll" />{t('mailbox.replyAll')}</button>
              )}
              <button className="btn btn-quiet" onClick={() => onReply('forward', item, email)}><Icon name="forward" />{t('mailbox.forward')}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Reader({ thread, focusId, secretKey, onAction, onBack, reply }: {
  thread: Thread;
  focusId: string;
  secretKey: Uint8Array;
  onAction: (a: ReaderAction, thread: Thread, item?: Item, email?: Email) => void;
  onBack: () => void;
  // Caixa de resposta aberta dentro da conversa (vem do Mailbox).
  reply?: ReactNode;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([thread.latest.id, focusId]));
  const items = thread.items;
  const last = items[items.length - 1];
  const folder = thread.inFolder[0]?.folder;
  const inTrash = folder === 'trash';
  const inSpam = folder === 'spam';

  // Conversa nova (ou chegou resposta): a última e a escolhida ficam abertas.
  useEffect(() => { setOpen(prev => new Set([...prev, thread.latest.id, focusId])); }, [thread.latest.id, focusId]);

  const toggle = (id: string) => setOpen(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // Conversas longas: as do meio ficam num "mais N mensagens" até a pessoa pedir.
  const [showAll, setShowAll] = useState(false);
  const hidden = !showAll && items.length > 4 ? items.slice(1, -2).filter(i => !open.has(i.id)) : [];
  const hiddenIds = new Set(hidden.map(i => i.id));

  return (
    <article className="reader" key={thread.key}>
      <div className="reader-bar">
        <div className="reader-back only-mobile">
          <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}><Icon name="back" /></button>
        </div>
        <div className="reader-actions">
          {inSpam ? (
            <>
              <button className="icon-btn" onClick={() => onAction('notspam', thread)} aria-label={t('mailbox.notSpam')} data-tip={t('mailbox.notSpam')}><Icon name="inbox" /></button>
              <button className="icon-btn" onClick={() => onAction('forever', thread)} aria-label={t('mailbox.deleteForever')} data-tip={t('mailbox.deleteForever')}><Icon name="trash" /></button>
            </>
          ) : inTrash ? (
            <>
              <button className="icon-btn" onClick={() => onAction('restore', thread)} aria-label={t('mailbox.untrash')} data-tip={t('mailbox.untrash')}><Icon name="undo" /></button>
              <button className="icon-btn" onClick={() => onAction('forever', thread)} aria-label={t('mailbox.deleteForever')} data-tip={t('mailbox.deleteForever')}><Icon name="trash" /></button>
            </>
          ) : (
            <>
              {folder === 'archive'
                ? <button className="icon-btn" onClick={() => onAction('inbox', thread)} aria-label={t('mailbox.toInbox')} data-tip={`${t('mailbox.toInbox')}   E`}><Icon name="inbox" /></button>
                : <button className="icon-btn" onClick={() => onAction('archive', thread)} aria-label={t('mailbox.archive')} data-tip={`${t('mailbox.archive')}   E`}><Icon name="archive" /></button>}
              <button className="icon-btn" onClick={() => onAction('trash', thread)} aria-label={t('reader.trash')} data-tip={`${t('reader.trashTip')}   #`}><Icon name="trash" /></button>
              {folder !== 'sent' && <button className="icon-btn" onClick={() => onAction('spam', thread)} aria-label={t('reader.markSpam')} data-tip={t('reader.markSpam')}><Icon name="spam" /></button>}
            </>
          )}
          <button className="icon-btn" onClick={() => onAction('unread', thread)} aria-label={t('mailbox.markUnread')} data-tip={t('mailbox.markUnread')}><Icon name="unread" /></button>
          <button className={`icon-btn ${thread.pinned ? 'is-starred' : ''}`} onClick={() => onAction('pin', thread)}
            aria-label={t(thread.pinned ? 'mailbox.unpin' : 'reader.pinTop')} data-tip={t(thread.pinned ? 'mailbox.unpin' : 'reader.pinTop')}><Icon name="pin" /></button>
          <button className={`icon-btn tip-end ${thread.starred ? 'is-starred' : ''}`} onClick={() => onAction('star', thread)}
            aria-label={t(thread.starred ? 'mailbox.unstar' : 'mailbox.star')} data-tip={t(thread.starred ? 'mailbox.unstar' : 'mailbox.star')}>
            <Icon name="star" />
          </button>
        </div>
      </div>

      <div className="reader-scroll">
        <header className="reader-head thread-head">
          <h1><bdi>{cleanSubject(items[0].h.subject) || t('common.noSubject')}</bdi></h1>
          {items.length > 1 && <span className="muted small">{tn('common.messages', items.length)}</span>}
        </header>
        <div className="thread">
          {items.map((item, i) => {
            if (hiddenIds.has(item.id)) {
              return hidden[0].id === item.id
                ? <button key="more" className="thread-more" onClick={() => setShowAll(true)}>{tn('reader.more', hidden.length)}</button>
                : null;
            }
            return (
              <MessageCard
                key={item.id}
                item={item}
                expanded={open.has(item.id) || item.id === last.id}
                onToggle={() => toggle(item.id)}
                secretKey={secretKey}
                isLast={item.id === last.id && i === items.length - 1 && !reply}
                onReply={(a, it, email) => onAction(a, thread, it, email)}
              />
            );
          })}
          {reply && <div className="thread-reply">{reply}</div>}
        </div>
      </div>
    </article>
  );
}

// Anexo: imagem vira um cartão com a prévia em cima (desenhada de um blob com o tipo conferido pelo
// começo do arquivo); o resto fica no botão compacto. Os dois baixam o arquivo ao clicar.
function FileButton({ file }: { file: Email['attachments'][number] }) {
  const type = useMemo(() => imageTypeOf(file), [file]);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!type || typeof file.content === 'string') return;
    const u = URL.createObjectURL(new Blob([file.content instanceof Uint8Array ? new Uint8Array(file.content) : file.content], { type }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, type]);
  const name = file.filename || t('reader.attachment');
  const bytes = size(typeof file.content === 'string' ? file.content.length : file.content.byteLength);
  if (url) {
    return (
      <button className="file file-image" onClick={() => downloadAttachment(file)} title={name}>
        <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />
        <span className="file-meta">
          <span className="file-name">{name}</span>
          <span className="muted small">{bytes}</span>
          <Icon name="download" size={16} className="file-dl" />
        </span>
      </button>
    );
  }
  return (
    <button className="file" onClick={() => downloadAttachment(file)}>
      <Icon name="clip" size={16} />
      <span className="file-name">{name}</span>
      <span className="muted small">{bytes}</span>
      <Icon name="download" size={16} className="file-dl" />
    </button>
  );
}
