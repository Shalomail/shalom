// Configurações: a pessoa, a segurança da conta, a aparência e o espaço. Cada linha mostra o estado à
// direita e abre ali mesmo quando a pessoa mexe; uma aberta por vez.
import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { fingerprint } from '../../../shared/fingerprint';
import { fromB64 } from '../../../shared/seal';
import { dayMonth, dayMonthYear, durationLabel, initials, shortDateTime, timeOf } from '../lib/format';
import { avatarUrl, changePassword, removeAvatar, saveName, uploadAvatarBlob } from '../lib/profile';
import {
  deleteAccount, disableTotp, enableTotp, getSecurity, idleChoices, newRecoveryCodes, qrSvg, removePin, setIdle as saveIdle, setPin as savePin,
  startTotp, type Security,
} from '../lib/security';
import { dropCurrent, type Session, type User } from '../lib/session';
import { createInvite, inviteLink, listInvites, revokeInvite, type Invite } from '../lib/invites';
import { getRecovery, resendRecovery, setRecovery, type Recovery } from '../lib/recovery';
import { navigate } from '../lib/router';
import { currentTheme, setSpectrum, setTheme, spectrumOn, type Theme } from '../lib/theme';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { PhotoCrop } from '../ui/PhotoCrop';
import { StorageBar } from '../ui/StorageBar';
import { LANG_NAMES, SUPPORTED, setLocale, t as tr, tn, useLocale, type Locale } from '../i18n';
import './settings.css';

type Device = { id: string; created_at: number; last_seen: number; user_agent: string; current: boolean };
type Panel = 'password' | 'recovery' | 'pin' | 'totp' | 'delete' | null;
type NoteKey = 'password' | 'recovery' | 'pin' | 'totp';

const fail = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

// Desenhos que só esta tela usa, no mesmo traço do Icon.
const GLYPHS = {
  camera: ['M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.6-2.2h5.4L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z', 'M12 9.6a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6z'],
  laptop: ['M5.5 5.5h13a1 1 0 0 1 1 1V16h-15V6.5a1 1 0 0 1 1-1z', 'M2.5 18.5h19'],
  copy: ['M10.5 8.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5V10a1.5 1.5 0 0 1 1.5-1.5z', 'M15 8.5v-3A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5H9'],
};
function Glyph({ name, size = 18 }: { name: keyof typeof GLYPHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// "Chrome no Mac", "Safari no iPhone". O servidor guarda só o user agent.
function deviceName(ua: string) {
  const browser = /EdgA?\/|EdgiOS/.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'Chromebook'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  if (browser && os) return tr('settings.browserOn', { browser, os });
  return browser || os || tr('settings.unknownBrowser');
}
const isPhone = (ua: string) => /iPhone|Android.*Mobile|Mobile.*Android/.test(ua);

function lastSeen(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return tr('settings.seenToday', { time: timeOf(d) });
  if (d.toDateString() === yesterday.toDateString()) return tr('settings.seenYesterday', { time: timeOf(d) });
  return tr('settings.seenOn', { date: d.getFullYear() === today.getFullYear() ? dayMonth(d) : dayMonthYear(d) });
}

function recoveryText(n: number) {
  return n === 0 ? tr('settings.codesNone') : tn('settings.codesLeft', n);
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function Profile({ session, avatarV, onUser, onAvatar, onBack, onIdle }: {
  session: Session;
  avatarV: number;
  onUser: (u: User) => void;
  onAvatar: (v: number) => void;
  // Sair fica no menu da conta; a prop continua para não quebrar quem chama.
  onSignOut: () => void;
  onBack: () => void;
  onIdle?: (minutes: number) => void;
}) {
  const { user, secretKey } = session;
  const [open, setOpen] = useState<Panel>(null);
  const [security, setSecurity] = useState<Security | null>(null);
  const [securityError, setSecurityError] = useState('');
  const [notes, setNotes] = useState<Partial<Record<NoteKey, string>>>({});
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [recovery, setRecoveryState] = useState<Recovery | null>(null);
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [theme, setThemeState] = useState<Theme>(currentTheme());
  const [spectrum, setSpectrumState] = useState(spectrumOn());
  const idleRef = useRef(onIdle);
  useEffect(() => { idleRef.current = onIdle; }, [onIdle]);
  // Impressão digital da própria chave, para ler para um contato que queira conferir a identidade.
  const [myFp, setMyFp] = useState('');
  useEffect(() => { fingerprint(user.address, fromB64(user.publicKey)).then(setMyFp).catch(() => {}); }, [user.address, user.publicKey]);
  // Convites só fazem sentido com o cadastro fechado.
  const [invitesOn, setInvitesOn] = useState(false);
  useEffect(() => { api<{ inviteOnly?: boolean }>('/auth/config').then(c => setInvitesOn(!!c.inviteOnly)).catch(() => {}); }, []);

  const loadSecurity = () => getSecurity()
    .then(s => { setSecurity(s); setSecurityError(''); idleRef.current?.(s.idle); })
    .catch(e => setSecurityError(fail(e, tr('settings.securityFail'))));
  const loadDevices = () => api<{ sessions: Device[] }>('/auth/sessions').then(r => setDevices(r.sessions)).catch(() => {});

  useEffect(() => {
    loadSecurity();
    loadDevices();
    getRecovery().then(setRecoveryState).catch(() => setRecoveryState({ hint: null, verified: false }));
    // O tema também muda pelo menu da conta.
    const sync = () => { setThemeState(currentTheme()); setSpectrumState(spectrumOn()); };
    window.addEventListener('shalom:theme', sync);
    return () => window.removeEventListener('shalom:theme', sync);
  }, []);

  const noteTimer = useRef(0);
  function note(key: NoteKey, text: string) {
    setNotes({ [key]: text });
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNotes({}), 6000);
  }
  // Com os códigos de recuperação na tela, nenhuma outra linha abre: eles só aparecem uma vez.
  const codesOnScreen = useRef(false);
  const toggle = (p: Exclude<Panel, null>) => {
    if (codesOnScreen.current) { document.querySelector('.st-row.is-open')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    setOpen(o => (o === p ? null : p));
  };
  const close = () => setOpen(null);

  function pickTheme(t: Theme) {
    setTheme(t);
    setThemeState(t);
  }
  function pickSpectrum(on: boolean) {
    setSpectrum(on);
    setSpectrumState(on);
  }

  async function changeIdle(m: number) {
    if (!security) return;
    const before = security.idle;
    setSecurity({ ...security, idle: m });
    try { await saveIdle(m); onIdle?.(m); }
    catch (e) { setSecurity(s => s && { ...s, idle: before }); setSecurityError(fail(e, tr('settings.idleFail'))); }
  }

  const totpOn = !!security?.totp;
  const fewCodes = totpOn && (security?.recoveryLeft ?? 10) <= 3;

  return (
    <main className="profile st">
      <div className="st-scroll">
        <div className="st-page">
          <header className="st-top">
            <button className="icon-btn only-mobile st-back" onClick={onBack} aria-label={tr('settings.backToInbox')}><Icon name="back" /></button>
            <h1>{tr('settings.title')}</h1>
          </header>

          <Section id="st-me" title={tr('settings.profile')} desc={tr('settings.profileDesc')}>
            <Me user={user} avatarV={avatarV} onUser={onUser} onAvatar={onAvatar} />
          </Section>

          <Section id="st-security" title={tr('settings.security')} desc={tr('settings.securityDesc')}>
            {securityError && <p className="st-error st-group-error">{securityError}</p>}

            <Row
              label={tr('settings.password')}
              desc={notes.password ? <Done>{notes.password}</Done> : tr('settings.passwordDesc')}
              side={open !== 'password' && <button className="st-btn" onClick={() => toggle('password')}>{tr('common.change')}</button>}
              open={open === 'password'}
            >
              <PasswordPanel user={user} secretKey={secretKey} onCancel={close}
                onDone={() => { close(); note('password', tr('settings.passwordChanged')); loadDevices(); }} />
            </Row>

            <Row
              label={tr('settings.recovery')}
              badge={recovery?.verified && <On>{tr('settings.confirmedBadge')}</On>}
              desc={notes.recovery ? <Done>{notes.recovery}</Done>
                : !recovery ? tr('common.checking')
                : !recovery.hint ? tr('settings.recoveryNone')
                : recovery.verified ? tr('settings.recoveryOk', { email: recovery.hint })
                : <span className="st-warn">{tr('settings.recoveryPending', { email: recovery.hint })}</span>}
              side={recovery && open !== 'recovery' && (
                <span className="st-side-pair">
                  {recovery.hint && !recovery.verified && (
                    <button className="st-btn st-btn-quiet" disabled={resend !== 'idle'} aria-live="polite" onClick={async () => {
                      // Um clique só: o botão trava enquanto envia e fica um minuto como "Reenviado".
                      setResend('sending');
                      try {
                        if ((await resendRecovery()).sent === false) { setSecurityError(tr('settings.resendFail')); setResend('idle'); return; }
                        note('recovery', tr('settings.resent', { email: recovery.hint ?? '' }));
                        setResend('sent');
                        window.setTimeout(() => setResend('idle'), 60_000);
                      } catch (e) { setSecurityError(fail(e, tr('settings.resendFail'))); setResend('idle'); }
                    }}>{resend === 'sending' ? <><span className="spinner" />{tr('settings.sending')}</> : resend === 'sent' ? <><Icon name="check" size={14} />{tr('settings.resentBtn')}</> : tr('settings.resend')}</button>
                  )}
                  <button className="st-btn" onClick={() => toggle('recovery')}>{recovery.hint ? tr('common.change') : tr('settings.choose')}</button>
                </span>
              )}
              open={open === 'recovery'}
            >
              <RecoveryPanel user={user} onCancel={close} onDone={r => { close(); setRecoveryState(r); note('recovery', tr((r as { sent?: boolean }).sent === false ? 'settings.recoveryNotSent' : 'settings.recoverySent', { email: r.hint ?? '' })); }} />
            </Row>

            <Row
              label={tr('settings.pin')}
              badge={security?.pin && <On>{tr('settings.pinOn')}</On>}
              desc={notes.pin ? <Done>{notes.pin}</Done> : tr('settings.pinDesc')}
              side={security && open !== 'pin' && (
                <button className="st-btn" onClick={() => toggle('pin')}>{security.pin ? tr('common.remove') : tr('settings.createPin')}</button>
              )}
              open={open === 'pin'}
            >
              {security && (
                <PinPanel user={user} on={security.pin} onCancel={close}
                  onDone={pin => { close(); setSecurity(s => s && { ...s, pin }); note('pin', tr(pin ? 'settings.pinCreated' : 'settings.pinRemoved')); }} />
              )}
            </Row>

            <Row
              label={tr('settings.totp')}
              badge={totpOn && <On>{tr('settings.totpOn')}</On>}
              desc={notes.totp ? <Done>{notes.totp}</Done>
                : security?.totp ? <span className={fewCodes ? 'st-warn' : undefined}>{recoveryText(security.recoveryLeft)}</span>
                : tr('settings.totpDesc')}
              side={security && open !== 'totp' && (
                <button className="st-btn" onClick={() => toggle('totp')}>{totpOn ? tr('settings.manage') : tr('settings.turnOn')}</button>
              )}
              open={open === 'totp'}
            >
              {security && (
                <TotpPanel user={user} on={totpOn} recoveryLeft={security.recoveryLeft} onCancel={close} onCodes={on => { codesOnScreen.current = on; }}
                  onChanged={() => loadSecurity()}
                  onFinished={text => { close(); loadSecurity(); note('totp', text); }} />
              )}
            </Row>

            <Row
              label={tr('settings.idle')}
              desc={tr('settings.idleDesc')}
              side={security && <IdleSelect value={security.idle} onChange={changeIdle} />}
            />

            <Row label={tr('settings.myFp')} desc={<><span className="st-fp" dir="ltr">{myFp || ' '}</span>{tr('settings.myFpDesc')}</>} />

            <Devices devices={devices} onRevoked={id => setDevices(list => list && list.filter(d => d.id !== id))} />
          </Section>

          {invitesOn && (
            <Section id="st-invites" title={tr('settings.inv.title')} desc={tr('settings.inv.desc')}>
              <Invites />
            </Section>
          )}

          <Section id="st-agents" title={tr('settings.agents.title')} desc={tr('settings.agents.desc')}>
            <Row label={tr('settings.agents.openLabel')} desc={tr('settings.agents.openDesc')}
              side={<button className="st-btn" onClick={() => navigate('/agentes-ia')}>{tr('settings.agents.open')}</button>} />
          </Section>

          <Section id="st-look" title={tr('settings.looks')} desc={tr('settings.looksDesc')}>
            <Row
              label={tr('settings.appTheme')}
              desc={tr(theme === 'dark' ? 'settings.darkNote' : 'settings.lightNote')}
              side={
                <div className="st-seg st-seg-themes" role="radiogroup" aria-label={tr('settings.theme')}>
                  {LOOKS.map(l => (
                    <button key={l.id} role="radio" aria-checked={theme === l.id} onClick={() => pickTheme(l.id)}>
                      <span className={`st-swatch is-${l.id}`} aria-hidden="true" />{tr(l.name)}
                    </button>
                  ))}
                </div>
              }
            />
            <Row
              label={<><span className="st-swatch is-spectrum" aria-hidden="true" />{tr('settings.spectrum')}</>}
              desc={tr('settings.spectrumDesc')}
              side={
                <button role="switch" aria-checked={spectrum} aria-label={tr('settings.spectrum')} className="st-switch" onClick={() => pickSpectrum(!spectrum)}>
                  <span />
                </button>
              }
            />
          </Section>

          <Section id="st-lang" title={tr('settings.language')} desc={tr('settings.languageDesc')}>
            <Row label={tr('settings.appLanguage')} side={<LanguageSelect />} />
          </Section>

          <Section id="st-space" title={tr('settings.space')} desc={tr('settings.spaceDesc')}>
            <StorageBar session={session} onSeeAll={() => navigate('/perfil/espaco')} />
          </Section>

          <Section id="st-delete" title={tr('settings.del.title')} desc={tr('settings.del.desc')}>
            <Row
              label={tr('settings.del.label')}
              desc={tr('settings.del.rowDesc')}
              side={open !== 'delete' && <button className="st-btn is-danger" onClick={() => toggle('delete')}>{tr('settings.del.open')}</button>}
              open={open === 'delete'}
            >
              <DeletePanel user={user} onCancel={close} />
            </Row>
          </Section>
        </div>
      </div>
    </main>
  );
}

const LOOKS: { id: Theme; name: 'settings.dark' | 'settings.light' }[] = [
  { id: 'dark', name: 'settings.dark' },
  { id: 'light', name: 'settings.light' },
];

// Idioma das telas: cada um no próprio nome. Vale na hora, fica salvo neste aparelho e vai para a conta
// (o servidor usa nos e-mails que manda); se o servidor ainda não souber guardar, segue só no aparelho.
function LanguageSelect() {
  const current = useLocale();
  async function pick(l: Locale) {
    await setLocale(l);
    api('/profile/lang', { body: { lang: l } }).catch(() => {});
  }
  return (
    <span className="st-select">
      <select value={current} onChange={e => pick(e.target.value as Locale)} aria-label={tr('settings.appLanguage')}>
        {SUPPORTED.map(l => <option key={l} value={l} lang={l}>{LANG_NAMES[l]}</option>)}
      </select>
      <Icon name="updown" size={14} />
    </span>
  );
}

// Seção em duas colunas: título e uma frase à esquerda, as linhas à direita. No celular, uma coluna só.
function Section({ id, title, desc, children }: { id: string; title: string; desc: string; children: ReactNode }) {
  return (
    <section className="st-group" aria-labelledby={id}>
      <div className="st-group-head">
        <h2 id={id}>{title}</h2>
        <p>{desc}</p>
      </div>
      <div className="st-group-body">{children}</div>
    </section>
  );
}

function Row({ label, badge, desc, side, open, children }: {
  label: ReactNode; badge?: ReactNode; desc?: ReactNode; side?: ReactNode; open?: boolean; children?: ReactNode;
}) {
  return (
    <div className={`st-row${open ? ' is-open' : ''}`}>
      <div className="st-row-text">
        <p className="st-label">{label}{badge}</p>
        {desc && <p className="st-desc">{desc}</p>}
      </div>
      {side ? <div className="st-side">{side}</div> : null}
      {open && children}
    </div>
  );
}

const On = ({ children }: { children: ReactNode }) => <span className="st-on">{children}</span>;
const Done = ({ children }: { children: ReactNode }) => <span className="st-done"><Icon name="check" size={14} />{children}</span>;

function Field(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="st-input" spellCheck={false} {...props} />;
}

// Campo com o nome em cima, e não só no placeholder.
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="st-field">
      <span className="st-field-label">{label}</span>
      {children}
    </label>
  );
}

// Senha com o olho para conferir o que foi digitado.
function Secret({ value, onChange, autoComplete, autoFocus, placeholder }: {
  value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="st-secret-field">
      <Field type={shown ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} placeholder={placeholder} />
      <button type="button" className="st-eye" onClick={() => setShown(s => !s)} aria-label={tr(shown ? 'common.hide' : 'common.show')} aria-pressed={shown}>
        <Icon name={shown ? 'eyeOff' : 'eye'} size={17} />
      </button>
    </span>
  );
}

// Seis casas para o PIN ou o código do autenticador. Um campo só por baixo (colar funciona), as casas
// só desenham: bolinha no PIN, o número no código.
function Digits({ value, onChange, label, state, masked = true, autoFocus, autoComplete = 'off', inputRef, onFull }: {
  value: string; onChange: (v: string) => void; label: string; state?: 'ok' | 'bad'; masked?: boolean; autoFocus?: boolean;
  autoComplete?: string; inputRef?: RefObject<HTMLInputElement | null>; onFull?: () => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div className={`st-pin${state ? ` is-${state}` : ''}`}>
      <input ref={inputRef} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete={autoComplete} aria-label={label} value={value} maxLength={6}
        spellCheck={false} autoFocus={autoFocus} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); onChange(v); if (v.length === 6 && value.length < 6) onFull?.(); }} />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} aria-hidden="true"
          className={`st-pin-cell${i < value.length ? ' is-filled' : ''}${masked ? ' is-masked' : ''}${focus && i === Math.min(value.length, 5) ? ' is-current' : ''}`}>
          {!masked && value[i]}
        </span>
      ))}
    </div>
  );
}

// Linha de estado embaixo dos campos: âmbar quando algo impede, verde quando está tudo certo.
function Status({ tone, children }: { tone: 'ok' | 'bad' | 'idle'; children: ReactNode }) {
  return (
    <p className={`st-status is-${tone}`} aria-live="polite">
      {tone === 'ok' && <Icon name="check" size={14} />}{tone === 'bad' && <Icon name="alert" size={14} />}{children}
    </p>
  );
}

function Busy({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return busy ? <><span className="spinner" />{busyLabel}</> : <>{label}</>;
}

// Uma etapa do painel: o número (ou o cadeado, quando é a única) à esquerda, título e campos à direita.
// "done" marca a etapa já vencida; "later" mostra a que vem depois, apagada.
function Step({ mark, title, desc, done, later, wide, children }: {
  mark?: ReactNode; title: string; desc?: ReactNode; done?: boolean; later?: boolean; wide?: boolean; children?: ReactNode;
}) {
  return (
    <div className={`st-stage${done ? ' is-done' : ''}${later ? ' is-later' : ''}`}>
      <span className="st-stage-mark" aria-hidden="true">{done ? <Icon name="check" size={14} /> : mark ?? <Icon name="lock" size={14} />}</span>
      <div className="st-stage-main">
        <p className="st-stage-title">{title}</p>
        {desc && <p className="st-stage-desc">{desc}</p>}
        {children && <div className={`st-stage-body${wide ? ' is-wide' : ''}`}>{children}</div>}
      </div>
    </div>
  );
}

const PanelError = ({ text }: { text: string }) => text ? <p className="st-error st-panel-error"><Icon name="alert" size={15} />{text}</p> : null;

// Painel aberto dentro da linha: as etapas em cima e, no rodapé, a nota de segurança e os botões
// (o principal por último, à direita). Entra inteiro na tela ao abrir (e a cada passo). Esc fecha.
function Panel({ onSubmit, onCancel, note, actions, children }: {
  onSubmit?: (e: FormEvent) => void; onCancel?: () => void; note?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLFormElement & HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.parentElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const keys = (e: KeyboardEvent) => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); } };
  const inner = <>
    <div className="st-panel-body">{children}</div>
    {(note || actions) && (
      <div className="st-panel-foot">
        {note && <p className="st-panel-note"><Icon name="shield" size={15} />{note}</p>}
        {actions && <div className="st-actions">{actions}</div>}
      </div>
    )}
  </>;
  return onSubmit
    ? <form ref={ref} className="st-panel" onSubmit={onSubmit} onKeyDown={keys}>{inner}</form>
    : <div ref={ref} className="st-panel" onKeyDown={keys}>{inner}</div>;
}

function Me({ user, avatarV, onUser, onAvatar }: { user: User; avatarV: number; onUser: (u: User) => void; onAvatar: (v: number) => void }) {
  const [name, setName] = useState(user.name);
  const [nameState, setNameState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [hasPhoto, setHasPhoto] = useState(false);
  // Foto escolhida esperando o enquadramento (PhotoCrop recorta e sobe).
  const [cropping, setCropping] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const skip = useRef(false);

  useEffect(() => { setName(user.name); }, [user.name]);
  // "Remover" só aparece quando existe foto.
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHasPhoto(true);
    img.onerror = () => setHasPhoto(false);
    img.src = avatarUrl(user.address, avatarV);
  }, [user.address, avatarV]);

  // Salva ao sair do campo ou no Enter; Esc desfaz.
  async function commitName() {
    if (skip.current) { skip.current = false; return; }
    const clean = name.trim();
    if (!clean) { setName(user.name); return; }
    if (clean === user.name) return;
    setNameState('saving');
    try {
      const saved = await saveName(clean);
      onUser({ ...user, name: saved });
      setName(saved);
      setNameState('saved');
      setTimeout(() => setNameState(s => (s === 'saved' ? '' : s)), 2000);
    } catch {
      setNameState('error');
    }
  }


  async function dropPhoto() {
    setPhotoBusy(true);
    setPhotoError('');
    try { await removeAvatar(); onAvatar(Date.now()); } catch (e) { setPhotoError(fail(e, tr('settings.photoRemoveFail'))); }
    setPhotoBusy(false);
  }

  return (
    <div className="st-me">
      <button className="st-photo" onClick={() => file.current?.click()} disabled={photoBusy} aria-label={tr(hasPhoto ? 'settings.changePhoto' : 'settings.addPhoto')}>
        <Avatar address={user.address} label={initials({ name: user.name, address: user.address })} version={avatarV} className="avatar st-avatar" />
        <span className="st-photo-badge">{photoBusy ? <span className="spinner" /> : <Glyph name="camera" size={15} />}</span>
      </button>
      <input ref={file} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setPhotoError(''); setCropping(f); } e.target.value = ''; }} />
      {/* No body: o painel tem backdrop-filter e prenderia o fixed dentro dele. */}
      {cropping && createPortal(
        <PhotoCrop file={cropping} onCancel={() => setCropping(null)}
          onSave={async blob => { onAvatar(await uploadAvatarBlob(blob)); setCropping(null); }} />,
        document.body,
      )}
      <div className="st-me-text">
        <div className="st-name-line">
          <label className="st-name" data-value={name || ' '}>
            <input ref={input} value={name} size={1} maxLength={60} autoComplete="name" aria-label={tr('settings.yourName')} spellCheck={false}
              onChange={e => { setName(e.target.value); if (nameState === 'error') setNameState(''); }}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { skip.current = true; setName(user.name); e.currentTarget.blur(); }
              }} />
          </label>
          {nameState === 'saving' ? <span className="spinner st-name-state" />
            : nameState === 'saved' ? <span className="st-done st-name-state"><Icon name="check" size={14} />{tr('settings.saved')}</span>
            : <button className="st-name-edit" onClick={() => input.current?.focus()} aria-label={tr('settings.editName')}><Icon name="pen" size={15} /></button>}
        </div>
        <p className="st-addr">{user.address}</p>
        {nameState === 'error' ? <p className="st-error">{tr('settings.nameFail')}</p>
          : photoError ? <p className="st-error">{photoError}</p>
          : (
            <div className="st-me-links">
              <button onClick={() => file.current?.click()} disabled={photoBusy}>{tr(hasPhoto ? 'settings.changePhoto' : 'settings.addPhoto')}</button>
              {hasPhoto && <button onClick={dropPhoto} disabled={photoBusy}>{tr('common.remove')}</button>}
            </div>
          )}
      </div>
    </div>
  );
}

function PasswordPanel({ user, secretKey, onDone, onCancel }: { user: User; secretKey: Uint8Array; onDone: () => void; onCancel: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next.length < 8) { setError(tr('settings.pwMin')); return; }
    if (next !== repeat) { setError(tr('settings.pwMismatch')); return; }
    setBusy(true);
    setError('');
    try { await changePassword(user, secretKey, current, next); onDone(); }
    catch (err) { setError(fail(err, tr('settings.pwFail'))); setBusy(false); }
  }

  const match = next.length >= 8 && repeat === next;
  const mismatch = repeat.length > 0 && repeat.length >= next.length && repeat !== next;
  return (
    <Panel onSubmit={submit} onCancel={onCancel}
      note={tr('settings.pwOthersOut')}
      actions={<>
        <button type="button" className="st-cancel" onClick={onCancel}>{tr('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!current || !match || busy}><Busy busy={busy} label={tr('settings.pwChange')} busyLabel={tr('settings.pwChanging')} /></button>
      </>}>
      <Step mark={1} title={tr('settings.confirmYou')}>
        <Labeled label={tr('settings.pwCurrent')}><Secret value={current} onChange={setCurrent} autoComplete="current-password" autoFocus /></Labeled>
      </Step>
      <Step mark={2} title={tr('settings.pwChooseNew')}>
        <Labeled label={tr('settings.pwNew')}><Secret value={next} onChange={setNext} autoComplete="new-password" /></Labeled>
        <Labeled label={tr('settings.pwRepeat')}><Secret value={repeat} onChange={setRepeat} autoComplete="new-password" /></Labeled>
        {mismatch ? <Status tone="bad">{tr('settings.pwNoMatch')}</Status>
          : match ? <Status tone="ok">{tr('settings.pwMatch')}</Status>
          : <Status tone="idle">{tr('settings.pwRule')}</Status>}
      </Step>
      <PanelError text={error} />
    </Panel>
  );
}

function RecoveryPanel({ user, onDone, onCancel }: { user: User; onDone: (r: Recovery) => void; onCancel: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError('');
    try { onDone(await setRecovery(email.trim(), { user, password })); }
    catch (err) { setError(fail(err, tr('settings.recoverySaveFail'))); setBusy(false); }
  }

  return (
    <Panel onSubmit={submit} onCancel={onCancel}
      note={tr('settings.recoveryNote')}
      actions={<>
        <button type="button" className="st-cancel" onClick={onCancel}>{tr('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!email.trim() || !password || busy}><Busy busy={busy} label={tr('settings.saveAndSend')} busyLabel={tr('common.saving')} /></button>
      </>}>
      <Step mark={1} title={tr('settings.confirmYou')}>
        <Labeled label={tr('settings.accountPassword')}><Secret value={password} onChange={setPassword} autoComplete="current-password" autoFocus /></Labeled>
      </Step>
      <Step mark={2} title={tr('settings.recoveryWhere')} desc={tr('settings.recoveryWhereDesc')}>
        <Labeled label={tr('settings.recovery')}>
          <Field type="email" dir="ltr" placeholder={tr('recovery.emailPlaceholder')} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" inputMode="email" autoCapitalize="none" />
        </Labeled>
      </Step>
      <PanelError text={error} />
    </Panel>
  );
}

// PIN fácil de adivinhar: tudo igual, sequência (123456, 654321) ou repetição (121212, 123123).
const weakPin = (p: string) => /^(\d)\1{5}$/.test(p) || /^(\d\d)\1\1$/.test(p) || /^(\d{3})\1$/.test(p)
  || '01234567890'.includes(p) || '09876543210'.includes(p);

// Apagar a conta: a senha e o endereço digitado. Deu certo, a conta some deste navegador e a tela de
// entrar abre com o aviso.
function DeletePanel({ user, onCancel }: { user: User; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = typed.trim().toLowerCase() === user.address;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !password || !matches) return;
    setBusy(true);
    setError('');
    try {
      await deleteAccount(user, password, typed);
      try { sessionStorage.setItem('shalom-notice', tr('settings.del.done')); } catch { /* sem armazenamento */ }
      await dropCurrent();
      location.assign('/entrar');
    } catch (err) { setError(fail(err, tr('settings.del.fail'))); setBusy(false); }
  }

  return (
    <Panel onSubmit={submit} onCancel={onCancel}
      note={tr('settings.del.note')}
      actions={<>
        <button type="button" className="st-cancel" onClick={onCancel}>{tr('common.cancel')}</button>
        <button className="btn btn-primary st-btn-danger" disabled={!password || !matches || busy}>
          <Busy busy={busy} label={tr('settings.del.confirm')} busyLabel={tr('settings.del.busy')} />
        </button>
      </>}>
      <Step mark={1} title={tr('settings.confirmYou')}>
        <Labeled label={tr('settings.accountPassword')}><Secret value={password} onChange={setPassword} autoComplete="current-password" autoFocus /></Labeled>
      </Step>
      <Step mark={2} title={tr('settings.del.typeTitle')} desc={tr('settings.del.typeDesc', { address: user.address })}>
        <Labeled label={tr('settings.del.typeLabel')}>
          <Field value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" dir="ltr" placeholder={user.address} />
        </Labeled>
      </Step>
      <PanelError text={error} />
    </Panel>
  );
}

function PinPanel({ user, on, onDone, onCancel }: { user: User; on: boolean; onDone: (pin: boolean) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const repeatRef = useRef<HTMLInputElement>(null);

  const weak = pin.length === 6 && weakPin(pin);
  const mismatch = repeat.length === 6 && pin !== repeat;
  const match = pin.length === 6 && repeat === pin && !weak;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!on && pin.length !== 6) { setError(tr('settings.pinDigits')); return; }
    if (!on && weak) { setError(tr('settings.pinWeakErr')); return; }
    if (!on && pin !== repeat) { setError(tr('settings.pinMismatch')); return; }
    setBusy(true);
    setError('');
    try {
      if (on) await removePin(user, password); else await savePin(user, password, pin);
      onDone(!on);
    } catch (err) { setError(fail(err, tr(on ? 'settings.pinRemoveFail' : 'settings.pinCreateFail'))); setBusy(false); }
  }

  const ready = on ? !!password : !!password && match;
  return (
    <Panel onSubmit={submit} onCancel={onCancel}
      note={tr(on ? 'settings.pinOffHint' : 'settings.pinNote')}
      actions={<>
        <button type="button" className="st-cancel" onClick={onCancel}>{tr('common.cancel')}</button>
        <button className={`btn btn-primary${on ? ' st-btn-danger' : ''}`} disabled={!ready || busy}>
          <Busy busy={busy} label={tr(on ? 'settings.removePin' : 'settings.createPin')} busyLabel={tr('settings.checkingPassword')} />
        </button>
      </>}>
      <Step mark={on ? undefined : 1} title={tr('settings.confirmYou')}>
        <Labeled label={tr('settings.accountPassword')}><Secret value={password} onChange={setPassword} autoComplete="current-password" autoFocus /></Labeled>
      </Step>
      {!on && (
        <Step mark={2} title={tr('settings.pinChoose')}>
          <div className="st-pin-line">
            <span className="st-field-label">{tr('settings.pinNew')}</span>
            <Digits value={pin} onChange={setPin} label={tr('settings.pinNew')} state={weak ? 'bad' : undefined} onFull={() => repeatRef.current?.focus()} />
          </div>
          <div className="st-pin-line">
            <span className="st-field-label">{tr('settings.pinRepeat')}</span>
            <Digits value={repeat} onChange={setRepeat} label={tr('settings.pinRepeat')} state={mismatch ? 'bad' : match ? 'ok' : undefined} inputRef={repeatRef} />
          </div>
          {weak ? <Status tone="bad">{tr('settings.pinWeak')}</Status>
            : mismatch ? <Status tone="bad">{tr('settings.pinMismatch')}</Status>
            : match ? <Status tone="ok">{tr('settings.pinMatch')}</Status>
            : <Status tone="idle">{tr('settings.pinAvoid')}</Status>}
        </Step>
      )}
      <PanelError text={error} />
    </Panel>
  );
}

type TotpStep =
  | { kind: 'password'; action: 'start' | 'codes' | 'off' }
  | { kind: 'manage' }
  | { kind: 'scan'; secret: string; qr: string }
  | { kind: 'codes'; codes: string[]; fresh: boolean };


function TotpPanel({ user, on, recoveryLeft, onChanged, onFinished, onCancel, onCodes }: {
  user: User; on: boolean; recoveryLeft: number; onChanged: () => void; onFinished: (note: string) => void; onCancel: () => void; onCodes: (on: boolean) => void;
}) {
  const [step, setStep] = useState<TotpStep>(on ? { kind: 'manage' } : { kind: 'password', action: 'start' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirmPassword(e: FormEvent) {
    e.preventDefault();
    if (busy || step.kind !== 'password') return;
    setBusy(true);
    setError('');
    try {
      if (step.action === 'start') {
        const { secret, uri } = await startTotp(user, password);
        setStep({ kind: 'scan', secret, qr: await qrSvg(uri) });
      } else if (step.action === 'codes') {
        setStep({ kind: 'codes', codes: (await newRecoveryCodes(user, password)).codes, fresh: false });
        onChanged();
      } else {
        await disableTotp(user, password);
        onFinished(tr('settings.totpOff'));
        return;
      }
      setPassword('');
    } catch (err) { setError(fail(err, tr('settings.continueFail'))); }
    setBusy(false);
  }

  async function confirmCode(e: FormEvent) {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const { codes } = await enableTotp(code);
      setStep({ kind: 'codes', codes, fresh: true });
      onChanged();
    } catch (err) { setError(fail(err, tr('settings.wrongCode'))); setCode(''); }
    setBusy(false);
  }

  if (step.kind === 'manage') {
    return (
      <Panel onCancel={onCancel} note={tr('settings.totpNote')} actions={<button type="button" className="st-cancel" onClick={onCancel}>{tr('common.close')}</button>}>
        <div className="st-choices">
          <div className="st-choice">
            <div>
              <p className="st-stage-title">{tr('settings.codesList')}</p>
              <p className="st-stage-desc">{recoveryText(recoveryLeft)} {tr('settings.codesReplace')}</p>
            </div>
            <button type="button" className="st-btn" onClick={() => setStep({ kind: 'password', action: 'codes' })}>{tr('settings.makeNew')}</button>
          </div>
          <div className="st-choice">
            <div>
              <p className="st-stage-title">{tr('settings.turnOffTitle')}</p>
              <p className="st-stage-desc">{tr('settings.turnOffDesc')}</p>
            </div>
            <button type="button" className="st-btn is-danger" onClick={() => setStep({ kind: 'password', action: 'off' })}>{tr('settings.turnOff')}</button>
          </div>
        </div>
      </Panel>
    );
  }

  if (step.kind === 'password') {
    const start = step.action === 'start';
    const label = tr(start ? 'common.continue' : step.action === 'codes' ? 'settings.makeCodes' : 'settings.turnOffTotp');
    const desc = tr(start ? 'settings.startDesc' : step.action === 'codes' ? 'settings.codesDesc' : 'settings.offDesc');
    const back = () => { setError(''); setPassword(''); setStep({ kind: 'manage' }); };
    return (
      <Panel onSubmit={confirmPassword} onCancel={onCancel} note={start ? tr('settings.totpNote') : undefined}
        actions={<>
          <button type="button" className="st-cancel" onClick={on ? back : onCancel}>{tr(on ? 'common.back' : 'common.cancel')}</button>
          <button className={`btn btn-primary${step.action === 'off' ? ' st-btn-danger' : ''}`} disabled={!password || busy}><Busy busy={busy} label={label} busyLabel={tr('settings.checkingPassword')} /></button>
        </>}>
        <Step mark={start ? 1 : undefined} title={tr('settings.confirmYou')} desc={desc}>
          <Labeled label={tr('settings.accountPassword')}><Secret value={password} onChange={setPassword} autoComplete="current-password" autoFocus /></Labeled>
        </Step>
        {start && <>
          <Step mark={2} title={tr('settings.scanShort')} later />
          <Step mark={3} title={tr('settings.typeCode')} later />
        </>}
        <PanelError text={error} />
      </Panel>
    );
  }

  if (step.kind === 'scan') {
    return <ScanStep secret={step.secret} qr={step.qr} code={code} setCode={setCode} busy={busy} error={error} onSubmit={confirmCode} onCancel={onCancel} />;
  }

  return (
    <CodesStep user={user} codes={step.codes} fresh={step.fresh} onShown={onCodes}
      onDone={() => onFinished(tr(step.fresh ? 'settings.totpDone' : 'settings.codesDone'))} />
  );
}

function ScanStep({ secret, qr, code, setCode, busy, error, onSubmit, onCancel }: {
  secret: string; qr: string; code: string; setCode: (v: string) => void; busy: boolean; error: string;
  onSubmit: (e: FormEvent) => void; onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const grouped = secret.match(/.{1,4}/g)?.join(' ') ?? secret;
  return (
    <Panel onSubmit={onSubmit} onCancel={onCancel} note={tr('settings.totpNote')}
      actions={<>
        <button type="button" className="st-cancel" onClick={onCancel}>{tr('common.cancel')}</button>
        <button className="btn btn-primary" disabled={code.length !== 6 || busy}><Busy busy={busy} label={tr('settings.turnOnTotp')} busyLabel={tr('settings.checkingShort')} /></button>
      </>}>
      <Step mark={1} title={tr('settings.pwConfirmed')} done />
      <Step mark={2} title={tr('settings.scanTitle')} wide>
        <div className="st-scan">
          {/* QR desenhado aqui no aparelho; fundo branco nos dois temas para a câmera ler. */}
          <div className="st-qr" dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label={tr('settings.qr')} />
          <div className="st-scan-text">
            <p className="st-stage-desc">{tr('settings.noCamera')}</p>
            <div className="st-secret">
              <span>{grouped}</span>
              <button type="button" className="st-btn st-btn-icon" onClick={async () => { if (await copyText(secret)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }}>
                {copied ? <><Icon name="check" size={15} />{tr('settings.copiedOne')}</> : <><Glyph name="copy" size={15} />{tr('common.copy')}</>}
              </button>
            </div>
          </div>
        </div>
      </Step>
      <Step mark={3} title={tr('settings.typeCodeLong')}>
        <Digits value={code} onChange={setCode} label={tr('settings.code6')} masked={false} autoComplete="one-time-code" autoFocus state={error ? 'bad' : undefined} />
      </Step>
      <PanelError text={error} />
    </Panel>
  );
}

function CodesStep({ user, codes, fresh, onDone, onShown }: { user: User; codes: string[]; fresh: boolean; onDone: () => void; onShown: (on: boolean) => void }) {
  useEffect(() => { onShown(true); return () => onShown(false); }, [onShown]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = [
    tr('settings.fileTitle'),
    tr('settings.fileAccount', { address: user.address }),
    tr('settings.fileDate', { date: shortDateTime(new Date()) }),
    '',
    tr('settings.fileNote'),
    '',
    ...codes,
    '',
  ].join('\n');

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tr('settings.fileName')}-${user.address.split('@')[0]}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Sem Esc aqui: os códigos só aparecem agora, então só fecha pelo "Concluir".
  return (
    <Panel note={tr('settings.codesOnce')}
      actions={<button className="btn btn-primary" disabled={!saved} onClick={onDone}>{tr('settings.finish')}</button>}>
      <Step mark={fresh ? <Icon name="check" size={14} /> : undefined} title={tr(fresh ? 'settings.freshTitle' : 'settings.newTitle')} wide>
        <ol className="st-codes" aria-label={tr('settings.codesList')}>{codes.map(c => <li key={c}>{c}</li>)}</ol>
        <div className="st-actions">
          <button className="st-btn st-btn-icon" onClick={async () => { if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }}>
            {copied ? <><Icon name="check" size={15} />{tr('settings.copiedMany')}</> : <><Glyph name="copy" size={15} />{tr('common.copy')}</>}
          </button>
          <button className="st-btn st-btn-icon" onClick={download}><Icon name="download" size={15} />{tr('settings.download')}</button>
        </div>
        <label className="st-check">
          <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
          {tr('settings.savedCheck')}
        </label>
      </Step>
    </Panel>
  );
}

// Convites: cria um link de uso único (quantos quiser), mostra o link só agora e lista os que já criou,
// disponíveis (com Cancelar) ou usados. Quem usou não aparece: o servidor nem guarda.
function Invites() {
  const [list, setList] = useState<Invite[] | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { listInvites().then(setList).catch(() => setList([])); }, []);

  async function make() {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const r = await createInvite();
      setLink(inviteLink(r.code));
      setList(l => [{ id: r.id, createdAt: r.createdAt, usedAt: null }, ...(l ?? [])]);
    } catch (e) { setError(fail(e, tr('settings.inv.fail'))); }
    setBusy(false);
  }
  async function revoke(id: string) {
    setList(l => l && l.filter(i => i.id !== id));
    await revokeInvite(id).catch(() => listInvites().then(setList).catch(() => {}));
  }
  const canShare = typeof navigator.share === 'function';

  return (
    <>
      <Row label={tr('settings.inv.create')} desc={tr('settings.inv.createDesc')}
        side={<button className="st-btn" onClick={make} disabled={busy}>{busy ? <><span className="spinner" />{tr('settings.inv.creating')}</> : tr('settings.inv.new')}</button>} />
      {link && (
        <div className="st-invite-new" role="status">
          <p className="st-stage-title">{tr('settings.inv.ready')}</p>
          <p className="st-stage-desc">{tr('settings.inv.readyNote')}</p>
          <div className="st-invite-link">
            <input className="st-input" readOnly value={link} dir="ltr" onFocus={e => e.target.select()} aria-label={tr('settings.inv.ready')} />
            <button className="st-btn st-btn-icon" onClick={async () => { if (await copyText(link)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }}>
              {copied ? <><Icon name="check" size={15} />{tr('settings.inv.copied')}</> : <><Glyph name="copy" size={15} />{tr('common.copy')}</>}
            </button>
            {canShare && <button className="st-btn" onClick={() => navigator.share({ text: `${tr('settings.inv.shareText')} ${link}` }).catch(() => {})}>{tr('settings.inv.share')}</button>}
          </div>
        </div>
      )}
      {error && <p className="st-error st-group-error">{error}</p>}
      {list && list.length > 0 && (
        <ul className="st-invites">
          {list.map(i => (
            <li key={i.id}>
              <span className={`st-invite-dot${i.usedAt ? ' is-used' : ''}`} aria-hidden="true" />
              <span className="st-invite-text">
                <strong>{tr(i.usedAt ? 'settings.inv.used' : 'settings.inv.open')}</strong>
                <span>{i.usedAt ? tr('settings.inv.usedOn', { date: dayMonthYear(new Date(i.usedAt)) }) : tr('settings.inv.createdOn', { date: dayMonthYear(new Date(i.createdAt)) })}</span>
              </span>
              {!i.usedAt && <button className="st-btn st-btn-quiet" onClick={() => revoke(i.id)}>{tr('settings.inv.revoke')}</button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function IdleSelect({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  const choices = idleChoices();
  const known = choices.some(([m]) => m === value);
  return (
    <span className="st-select">
      <select value={value} onChange={e => onChange(Number(e.target.value))} aria-label={tr('settings.idle')}>
        {!known && <option value={value}>{durationLabel(value)}</option>}
        {choices.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
      </select>
      <Icon name="updown" size={14} />
    </span>
  );
}

// Mostra este aparelho e os três usados por último; o resto fica atrás de "Mostrar todos".
const DEVICES_SHOWN = 4;

function Devices({ devices, onRevoked }: { devices: Device[] | null; onRevoked: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState(false);
  const list = devices ? [...devices].sort((a, b) => Number(b.current) - Number(a.current) || b.last_seen - a.last_seen) : [];
  const others = list.filter(d => !d.current);
  const shown = all ? list : list.slice(0, DEVICES_SHOWN);

  async function revoke(ids: string[], key: string) {
    setBusy(key);
    setError('');
    const results = await Promise.allSettled(ids.map(id => api('/auth/sessions/revoke', { body: { id } })));
    results.forEach((r, i) => { if (r.status === 'fulfilled') onRevoked(ids[i]); });
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) setError(fail(failed.reason, tr('settings.devicesFail')));
    setBusy(null);
  }

  return (
    <div className="st-row st-devices">
      <div className="st-row-text">
        <p className="st-label">{tr('settings.devices')}</p>
        <p className="st-desc">{tr('settings.devicesDesc')}</p>
      </div>
      {others.length > 1 && (
        <div className="st-side st-devices-all">
          <button className="st-btn" onClick={() => setAsk(true)} disabled={!!busy}>{tr('settings.disconnectOthers')}</button>
        </div>
      )}
      {ask && (
        <Confirm
          title={tr('settings.disconnectTitle')}
          text={tn('settings.disconnectText', others.length)}
          action={tr('settings.disconnect')}
          busy={busy === 'all'}
          onCancel={() => setAsk(false)}
          onConfirm={async () => { await revoke(others.map(d => d.id), 'all'); setAsk(false); }}
        />
      )}
      {devices && (
        <ul className="st-device-list">
          {shown.map(d => (
            <li key={d.id} className="st-device">
              <span className="st-device-icon">{isPhone(d.user_agent) ? <Icon name="device" size={17} /> : <Glyph name="laptop" size={17} />}</span>
              <span className="st-device-text">
                <strong>{deviceName(d.user_agent)}</strong>
                <span>{d.current ? tr('settings.thisDevice') : lastSeen(d.last_seen)}</span>
              </span>
              {!d.current && (
                <button className="st-btn" onClick={() => revoke([d.id], d.id)} disabled={!!busy}>
                  {busy === d.id ? <span className="spinner" /> : tr('settings.disconnect')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > DEVICES_SHOWN && (
        <button className="st-more" onClick={() => setAll(a => !a)}>
          {all ? tr('settings.showLess') : tr('settings.showAll', { n: list.length })}
        </button>
      )}
      {error && <p className="st-error st-devices-error">{error}</p>}
    </div>
  );
}

// Confirmação dentro do app (o confirm do navegador trava a página). Foco no Cancelar; Esc e clique fora cancelam.
function Confirm({ title, text, action, busy, onConfirm, onCancel }: {
  title: string; text: string; action: string; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => back?.focus();
  }, []);
  function keys(e: KeyboardEvent) {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); }
    // O Tab fica preso nos dois botões.
    if (e.key === 'Tab') {
      const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    }
  }
  return createPortal(
    <div className="st-modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }} onKeyDown={keys}>
      <div ref={box} className="st-modal" role="alertdialog" aria-modal="true" aria-labelledby="st-modal-title" aria-describedby="st-modal-text">
        <h3 id="st-modal-title">{title}</h3>
        <p id="st-modal-text">{text}</p>
        <div className="st-modal-actions">
          <button ref={cancel} className="btn btn-quiet" onClick={onCancel} disabled={busy}>{tr('common.cancel')}</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy}><Busy busy={busy} label={action} busyLabel={tr('settings.disconnecting')} /></button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
