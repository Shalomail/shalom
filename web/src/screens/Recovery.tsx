// Telas da recuperação: pedir o e-mail de recuperação antes da primeira caixa, confirmar o link que
// chegou nele e criar senha nova. Mesmo visual das telas de entrar (claro, paz ao fundo, logo em espectro).
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { confirmRecovery, resetInfo, resetPassword, setRecovery, tokenFromUrl } from '../lib/recovery';
import { t } from '../i18n';
import { navigate } from '../lib/router';
import type { Session } from '../lib/session';
import { Icon, Mark } from '../ui/Icon';
import { PeaceBackdrop } from '../ui/PeaceBackdrop';
import { ArrowField, PasswordInput } from './Auth';

function Shell({ children, top }: { children: ReactNode; top?: ReactNode }) {
  return (
    <div className="auth" data-theme="dark">
      <PeaceBackdrop />
      <header className="auth-top">
        <a href="/" className="auth-home"><Icon name="back" size={16} />shalomail.com</a>
        {top}
      </header>
      <main className="auth-main">
        <div className="auth-stage">
          <span className="auth-mark" aria-hidden="true"><Mark size={64} /></span>
          {children}
        </div>
      </main>
    </div>
  );
}

// Antes da primeira caixa: o e-mail de recuperação é obrigatório. A confirmação pelo link pode vir depois.
export function RecoveryGate({ session, onDone, onSignOut }: { session: Session; onDone: () => void; onSignOut: () => void }) {
  const [email, setEmail] = useState('');
  // Depois de 15 minutos da entrada, o servidor pede a senha também (é o caminho para tomar a conta).
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  // Guardado, mas o link não saiu (cota de envio do dia): a tela diz isso em vez de mandar conferir o e-mail.
  const [mailed, setMailed] = useState(true);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy || (askPassword && !password)) return;
    setBusy(true);
    setError('');
    try {
      const r = await setRecovery(email.trim(), askPassword ? { user: session.user, password } : undefined);
      setMailed(r.sent !== false);
      setSent(r.hint);
    } catch (err) {
      // A primeira recusa sem senha não é erro da pessoa: só abre o campo da senha.
      if (!askPassword && err instanceof ApiError && err.code === 'wrong') setAskPassword(true);
      else setError(err instanceof Error ? err.message : t('recovery.saveFail'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Shell>
        <div className="auth-form">
          <h1>{t(mailed ? 'recovery.checkEmail' : 'recovery.notSentTitle')}</h1>
          <p className="auth-note">{t(mailed ? 'recovery.sentTo' : 'recovery.notSent', { email: sent })}</p>
          <button className="btn btn-primary btn-lg recovery-go" onClick={onDone}>{t('recovery.openInbox')}</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell top={<button type="button" className="auth-top-btn" onClick={onSignOut}>{t('bc.signOut')}</button>}>
      <form className="auth-form" onSubmit={submit}>
        <h1>{t('recovery.title')}</h1>
        {askPassword ? (
          <>
            <p className="auth-chip"><span dir="ltr">{email.trim()}</span><button type="button" onClick={() => { setAskPassword(false); setPassword(''); setError(''); }}>{t('common.change')}</button></p>
            <ArrowField ready={!!password} busy={busy} label={t('common.save')}>
              <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" label={t('settings.accountPassword')} />
            </ArrowField>
          </>
        ) : (
          <ArrowField ready={valid} busy={busy} label={t('common.save')}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('recovery.emailPlaceholder')} aria-label={t('recovery.title')} dir="ltr"
              autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoFocus />
          </ArrowField>
        )}
        {error
          ? <p className="auth-note is-warn" role="alert">{error}</p>
          : <p className="auth-note">{session.user.name.split(' ')[0] ? t('recovery.gateNoteName', { name: session.user.name.split(' ')[0] }) : t('recovery.gateNote')}</p>}
      </form>
    </Shell>
  );
}

// Link de confirmação que chegou no e-mail de recuperação.
export function ConfirmRecovery() {
  const [state, setState] = useState<{ ok?: boolean; hint?: string | null; error?: string }>({});
  useEffect(() => {
    const token = tokenFromUrl();
    if (!token) { setState({ error: t('recovery.linkIncomplete') }); return; }
    confirmRecovery(token).then(r => setState({ ok: true, hint: r.hint })).catch(e => setState({ error: e instanceof Error ? e.message : t('recovery.confirmFail') }));
  }, []);
  return (
    <Shell>
      <div className="auth-form">
        <h1>{t(state.ok ? 'recovery.confirmed' : state.error ? 'recovery.confirmFail' : 'recovery.confirming')}</h1>
        {state.ok && <p className="auth-note is-ok"><Icon name="check" size={14} />{state.hint ? t('recovery.isYours', { email: state.hint }) : t('recovery.isConfirmed')}</p>}
        {state.error && <p className="auth-note is-warn" role="alert">{state.error}</p>}
        {(state.ok || state.error) && <a className="auth-back" href="/entrar" onClick={e => { e.preventDefault(); navigate('/caixa/inbox'); }}>{t('recovery.goToApp')}</a>}
      </div>
    </Shell>
  );
}

// Senha nova pelo link de recuperação. Gera chave nova no aparelho; a caixa antiga é esvaziada.
export function ResetPassword({ onSession }: { onSession: (s: Session) => void }) {
  const [token] = useState(tokenFromUrl);
  const [info, setInfo] = useState<{ address: string; need: { pin: boolean; totp: boolean } } | null>(null);
  const [gone, setGone] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setGone(t('recovery.linkIncompleteAsk')); return; }
    resetInfo(token).then(setInfo).catch(e => setGone(e instanceof Error ? e.message : t('recovery.linkGone')));
  }, [token]);

  const ready = password.length >= 8 && password === repeat
    && (!info?.need.pin || /^\d{6}$/.test(pin))
    && (!info?.need.totp || /^\d{6}$/.test(code) || code.replace(/[^a-z0-9]/gi, '').length === 8);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy || !info) return;
    setBusy(true);
    setError('');
    try {
      const isRecovery = info.need.totp && !/^\d{6}$/.test(code);
      onSession(await resetPassword(token, password, {
        pin: info.need.pin ? pin : undefined,
        code: info.need.totp && !isRecovery ? code : undefined,
        recovery: isRecovery ? code : undefined,
      }, info.address));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'link') setGone(err.message);
      setError(err instanceof Error ? err.message : t('recovery.resetFail'));
      setBusy(false);
    }
  }

  if (gone) {
    return (
      <Shell>
        <div className="auth-form">
          <h1>{t('recovery.expired')}</h1>
          <p className="auth-note is-warn">{gone}</p>
          <a className="auth-back" href="/entrar" onClick={e => { e.preventDefault(); navigate('/entrar'); }}>{t('recovery.goToSignIn')}</a>
        </div>
      </Shell>
    );
  }
  if (!info) return <Shell><div className="auth-form"><h1>{t('recovery.checkingLink')}</h1></div></Shell>;

  return (
    <Shell>
      <form className="auth-form reset-form" onSubmit={submit}>
        <h1>{t('recovery.newPassword')}</h1>
        <p className="reset-for">{info.address}</p>
        <p className="reset-warn"><Icon name="alert" size={16} />{t('recovery.warning')}</p>
        <div className="reset-fields">
          <div className="arrow-field"><PasswordInput value={password} onChange={setPassword} autoComplete="new-password" label={t('recovery.newPassword')} /></div>
          <div className="arrow-field"><PasswordInput value={repeat} onChange={setRepeat} autoComplete="new-password" label={t('pw.same')} /></div>
          {info.need.pin && (
            <div className="arrow-field"><input type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder={t('recovery.yourPin')} aria-label={t('auth.pinLabel')} autoComplete="off" /></div>
          )}
          {info.need.totp && (
            <div className="arrow-field"><input value={code} onChange={e => setCode(e.target.value.slice(0, 9))} inputMode="text" placeholder={t('recovery.codeOrRecovery')} aria-label={t('auth.codeLabel')} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} /></div>
          )}
        </div>
        {error
          ? <p className="auth-note is-warn" role="alert">{error}</p>
          : <p className="auth-note">{t(password && password.length < 8 ? 'pw.min' : repeat && repeat !== password ? 'pw.mismatch' : 'pw.hint')}</p>}
        <button className="btn btn-primary btn-lg recovery-go" disabled={!ready || busy}>{busy ? <><span className="spinner" />{t('recovery.creatingKey')}</> : t('recovery.create')}</button>
      </form>
    </Shell>
  );
}
