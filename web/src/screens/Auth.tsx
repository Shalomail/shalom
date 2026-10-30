import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { navigate, usePath } from '../lib/router';
import { accounts } from '../lib/accounts';
import { forgotPassword } from '../lib/recovery';
import { DOMAIN, signIn, signInSecond, signUp, switchAccount, type SecondStep, type Session } from '../lib/session';
import { Icon, Mark, type IconName } from '../ui/Icon';
import { PeaceBackdrop } from '../ui/PeaceBackdrop';
import { Avatar } from '../ui/Avatar';
import { initials } from '../lib/format';
import { Turnstile } from '../ui/Turnstile';
import { locale, t as tr } from '../i18n';
import { rich } from '../i18n/rich';

type Config = { domain: string; turnstileSiteKey: string; inviteOnly?: boolean };

// Convite da fase de teste: chega no link (?convite=...) e fica guardado nesta aba até o cadastro.
function inviteCode(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('convite');
    if (fromUrl) sessionStorage.setItem('shalom-invite', fromUrl);
    return sessionStorage.getItem('shalom-invite') || '';
  } catch { return ''; }
}

const localPart = (s: string) => s.trim().toLowerCase().replace(/@.*$/, '');
const go = (to: string) => (e: React.MouseEvent) => { e.preventDefault(); navigate(to); };
// Termos e privacidade do site no mesmo idioma (português na raiz, os outros em /en/terms/ etc.).
const legalPage = (page: 'terms' | 'privacy') => (locale() === 'pt' ? (page === 'terms' ? '/termos/' : '/privacidade/') : `/${locale()}/${page}/`);

// Um campo só, com o ícone do que se digita à esquerda e a seta de avançar dentro dele. Enter também avança.
export function ArrowField({ children, ready, busy, label, icon }: { children: ReactNode; ready: boolean; busy: boolean; label: string; icon?: IconName }) {
  return (
    <div className={`arrow-field${ready ? ' is-ready' : ''}`}>
      {icon && <span className="arrow-icon" aria-hidden="true"><Icon name={icon} size={16} /></span>}
      {children}
      <button className="arrow-go" disabled={!ready || busy} aria-label={label}>
        {busy ? <span className="spinner" /> : <Icon name="arrow" size={18} />}
      </button>
    </div>
  );
}

// Endereço com o "@shalomail.com" colado logo depois do texto, andando conforme a pessoa digita.
function AddressInput({ value, onChange, domain }: { value: string; onChange: (v: string) => void; domain: string }) {
  return (
    <label className="addr-line" dir="ltr">
      <span className="addr-grow" data-value={value || tr('auth.addressPlaceholder')}>
        <input value={value} onChange={e => onChange(e.target.value.replace(/\s/g, ''))} autoComplete="username" placeholder={tr('auth.addressPlaceholder')}
          aria-label={tr('auth.addressLabel')} required autoCapitalize="none" spellCheck={false} autoFocus maxLength={32} inputMode="email" size={1} />
      </span>
      <span className="field-suffix">@{domain}</span>
    </label>
  );
}

export function PasswordInput({ value, onChange, autoComplete, label }: { value: string; onChange: (v: string) => void; autoComplete: string; label: string }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={label} aria-label={label}
        autoComplete={autoComplete} required spellCheck={false} autoFocus />
      <button type="button" className="field-eye" onClick={() => setShow(!show)} aria-label={tr(show ? 'pw.hide' : 'pw.show')}>
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </>
  );
}


// Login em duas perguntas: o endereço (o app confere se a conta existe) e a senha. Conta com PIN e/ou
// duas etapas ganha mais uma ou duas perguntas no fim, e só então a caixa abre.
function SignInForm({ config, onSession }: { config: Config; onSession: (s: Session) => void }) {
  const [step, setStep] = useState<'address' | 'password' | 'pin' | 'totp' | 'forgot'>('address');
  const [forgotSent, setForgotSent] = useState(false);
  const [second, setSecond] = useState<SecondStep | null>(null);
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [remember, setRemember] = useState(true);
  const local = localPart(address);

  async function checkAddress(e: FormEvent) {
    e.preventDefault();
    if (!local || busy) return;
    setBusy(true);
    setError('');
    setMissing(false);
    try {
      // Conta que já está aberta neste navegador: só troca para ela.
      const open = accounts().find(a => a.address === `${local}@${config.domain}`);
      if (open) { switchAccount(open.slot); return; }
      const r = await api<{ exists: boolean }>('/auth/exists', { body: { address: local } });
      if (r.exists) setStep('password');
      else setMissing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('auth.checkFail'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await signIn(local, password, remember, token ?? undefined);
      if ('ticket' in r) {
        setSecond(r);
        setStep(r.need.pin ? 'pin' : 'totp');
        setBusy(false);
        return;
      }
      onSession(r);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'captcha' || code === 'wrong_captcha') { setNeedCaptcha(true); setResetKey(k => k + 1); setToken(null); }
      setError(err instanceof Error ? err.message : tr('auth.signInFail'));
      setBusy(false);
    }
  }

  async function finishSecond(e: FormEvent) {
    e.preventDefault();
    if (!second || busy) return;
    if (step === 'pin' && second.need.totp) { setError(''); setStep('totp'); return; }
    setBusy(true);
    setError('');
    try {
      onSession(await signInSecond(second, {
        pin: second.need.pin ? pin : undefined,
        code: second.need.totp && !useRecovery ? code : undefined,
        recovery: second.need.totp && useRecovery ? code : undefined,
      }));
    } catch (err) {
      const c = err instanceof ApiError ? err.code : '';
      setError(err instanceof Error ? err.message : tr('auth.signInFail'));
      setBusy(false);
      setCode('');
      if (c === 'ticket') { setSecond(null); setPin(''); setStep('password'); }
      else if (second.need.pin && (!second.need.totp || c === 'wrong_second')) { setPin(''); setStep('pin'); }
    }
  }

  async function sendForgot() {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await forgotPassword(local); setForgotSent(true); } catch (err) { setError(err instanceof Error ? err.message : tr('auth.linkFail')); }
    setBusy(false);
  }

  // Esqueci a senha: o aviso de que os e-mails guardados não voltam vem antes de pedir o link.
  if (step === 'forgot') {
    return (
      <div className="auth-form" key="signin-forgot">
        <h1>{tr('auth.forgot')}</h1>
        <p className="reset-for">{local}@{config.domain}</p>
        {forgotSent ? (
          <p className="auth-note is-ok"><Icon name="check" size={14} />{tr('auth.forgotSent')}</p>
        ) : (
          <>
            <p className="reset-warn"><Icon name="alert" size={16} />{tr('recovery.warning')}</p>
            <button className="btn btn-primary btn-lg recovery-go" onClick={sendForgot} disabled={busy}>{busy ? <span className="spinner" /> : tr('auth.forgotSend')}</button>
          </>
        )}
        {error && <p className="auth-note is-warn" role="alert">{error}</p>}
        <button type="button" className="auth-back" onClick={() => { setStep('password'); setForgotSent(false); setError(''); }}>{tr('auth.remembered')}</button>
      </div>
    );
  }

  if (step === 'pin' || step === 'totp') {
    const ready = step === 'pin' ? /^\d{6}$/.test(pin) : useRecovery ? code.replace(/[^a-z0-9]/gi, '').length === 8 : /^\d{6}$/.test(code);
    return (
      <form onSubmit={finishSecond} className="auth-form" key={`signin-${step}`}>
        <h1>{tr(step === 'pin' ? 'auth.pinTitle' : useRecovery ? 'auth.recoveryTitle' : 'auth.codeTitle')}</h1>
        <ArrowField ready={ready} busy={busy} label={tr(step === 'pin' && second?.need.totp ? 'common.continue' : 'auth.signIn')} icon="shield">
          {step === 'pin'
            ? <input type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off"
                placeholder={tr('auth.pinPlaceholder')} aria-label={tr('auth.pinLabel')} autoFocus />
            : <input value={code} onChange={e => setCode(useRecovery ? e.target.value.slice(0, 9) : e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" placeholder={useRecovery ? 'xxxx-xxxx' : tr('auth.codePlaceholder')}
                aria-label={tr('auth.codeLabel')} autoCapitalize="none" spellCheck={false} autoFocus />}
        </ArrowField>
        {error
          ? <p className="auth-note is-warn" role="alert">{error}</p>
          : <p className="auth-note">{tr(step === 'pin' ? 'auth.pinNote' : useRecovery ? 'auth.recoveryNote' : 'auth.codeNote')}</p>}
        {step === 'totp' && (
          <button type="button" className="auth-back" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(''); }}>
            {tr(useRecovery ? 'auth.useApp' : 'auth.noPhone')}
          </button>
        )}
        <button type="button" className="auth-back" onClick={() => { setSecond(null); setPin(''); setCode(''); setError(''); setStep('password'); }}>{tr('common.back')}</button>
      </form>
    );
  }

  if (step === 'address') {
    return (
      <form onSubmit={checkAddress} className="auth-form" key="signin-address">
        <h1>{tr('auth.signInTitle')}</h1>
        <ArrowField ready={!!local} busy={busy} label={tr('common.continue')} icon="at">
          <AddressInput value={address} onChange={v => { setAddress(v); setMissing(false); }} domain={config.domain} />
        </ArrowField>
        {missing && (
          <p className="auth-note is-warn" role="alert">
            {rich(tr('auth.noAccount', { address: `${local}@${config.domain}` }), { link: s => <a href="/criar-conta" onClick={go('/criar-conta')}>{s}</a> })}
          </p>
        )}
        {error && <p className="auth-note is-warn" role="alert">{error}</p>}
        {!missing && !error && <p className="auth-note is-secure"><Icon name="lock" size={13} />{tr('auth.signInNote')}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="auth-form" key="signin-password">
      <h1>{tr('auth.passwordTitle')}</h1>
      {/* Para o gerenciador de senhas ligar a senha ao endereço certo. */}
      <input className="hp" type="text" autoComplete="username" value={`${local}@${config.domain}`} readOnly tabIndex={-1} aria-hidden="true" />
      <ArrowField ready={!!password && (!needCaptcha || !!token)} busy={busy} label={tr('auth.signIn')} icon="lock">
        <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" label={tr('pw.label')} />
      </ArrowField>
      {needCaptcha && <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} resetKey={resetKey} />}
      {error && <p className="auth-note is-warn" role="alert">{error}</p>}
      <label className="auth-remember">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
        <span>{tr('auth.remember')}</span>
      </label>
      <button type="button" className="auth-back" onClick={() => { setStep('forgot'); setError(''); }}>{tr('auth.forgot')}</button>
      <button type="button" className="auth-back auth-back-tight" onClick={() => { setStep('address'); setPassword(''); setError(''); }}>{tr('auth.changeAddress')}</button>
    </form>
  );
}

// Endereço escolhido no campo da página inicial; vale uma vez só.
function takeClaim(): string {
  try {
    const v = sessionStorage.getItem('shalom-claim') || new URLSearchParams(location.search).get('endereco') || '';
    sessionStorage.removeItem('shalom-claim');
    return v.trim().toLowerCase().replace(/\s|@.*$/g, '').slice(0, 32);
  } catch { return ''; }
}

type Avail = { state: 'idle' | 'checking' | 'ok' | 'taken' | 'reserved' | 'invalid' };
const STEPS = 4;

// Cadastro uma pergunta por vez: nome, endereço, senha, confirmação.
function SignUpFlow({ config, onSession }: { config: Config; onSession: (s: Session, fresh?: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [address, setAddress] = useState(takeClaim);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [website, setWebsite] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [avail, setAvail] = useState<Avail>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const [invite] = useState(inviteCode);

  const local = localPart(address);
  const mismatch = confirm.length > 0 && confirm !== password;


  useEffect(() => {
    if (local.length < 3) { setAvail({ state: local ? 'invalid' : 'idle' }); return; }
    const n = ++seq.current;
    setAvail({ state: 'checking' });
    const t = setTimeout(async () => {
      const r = await api<{ available: boolean; reason: string | null }>('/auth/available', { body: { address: local } }).catch(() => null);
      if (n !== seq.current || !r) return;
      setAvail({ state: r.available ? 'ok' : (r.reason as Avail['state']) || 'taken' });
    }, 300);
    return () => clearTimeout(t);
  }, [local]);

  const canNext = [
    name.trim().length > 0,
    avail.state === 'ok',
    password.length >= 8,
    confirm === password && confirm.length > 0 && !!token,
  ][step];

  async function next(e?: FormEvent) {
    e?.preventDefault();
    if (!canNext || busy) return;
    if (step < STEPS - 1) { setError(''); setStep(step + 1); return; }
    setBusy(true);
    setError('');
    try {
      onSession(await signUp(local, name.trim(), password, token!, website, invite || undefined), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('auth.signUpFail'));
      setResetKey(k => k + 1);
      setToken(null);
      setBusy(false);
    }
  }

  const titles = [tr('auth.nameTitle'), tr('auth.addressTitle'), tr('auth.passwordNewTitle'), tr('auth.repeatTitle')];
  const hints: ReactNode[] = [
    tr('auth.nameHint'),
    { idle: tr('auth.addrIdle'), checking: tr('common.checking'), ok: <><Icon name="check" size={14} />{tr('auth.addrOk')}</>,
      taken: tr('auth.addrTaken'), reserved: tr('auth.addrReserved'), invalid: tr('auth.addrInvalid') }[avail.state],
    password && password.length < 8 ? tr('pw.min') : tr('pw.hint'),
    mismatch ? tr('pw.mismatch') : tr('auth.keyBorn'),
  ];
  const warn = (step === 1 && ['taken', 'reserved'].includes(avail.state)) || (step === 2 && password.length > 0 && password.length < 8) || (step === 3 && mismatch);

  if (config.inviteOnly && !invite) {
    return (
      <div className="auth-form">
        <h1>{tr('auth.inviteTitle')}</h1>
        <p className="auth-note">{tr('auth.inviteNote')}</p>
        <a className="auth-back" href="/entrar" onClick={go('/entrar')}>{tr('auth.haveAccount')}</a>
      </div>
    );
  }

  return (
    <form onSubmit={next} className="auth-form" key="signup">
      <div className="step" key={step}>
        <h1>{titles[step]}</h1>
        <ArrowField ready={!!canNext} busy={busy} label={tr(step < STEPS - 1 ? 'common.continue' : 'auth.createMine')} icon={step === 0 ? 'user' : step === 1 ? 'at' : 'lock'}>
          {step === 0 && <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder={tr('auth.namePlaceholder')} aria-label={tr('auth.namePlaceholder')} required maxLength={60} autoFocus />}
          {step === 1 && <AddressInput value={address} onChange={setAddress} domain={config.domain} />}
          {step === 2 && <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" label={tr('pw.label')} />}
          {step === 3 && <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" label={tr('pw.same')} />}
        </ArrowField>
        <p className={`auth-note ${warn ? 'is-warn' : ''} ${step === 1 && avail.state === 'ok' ? 'is-ok' : ''}`}>{hints[step]}</p>
        {step === 3 && <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} resetKey={resetKey} />}
        {error && <p className="auth-note is-warn" role="alert">{error}</p>}
        {step === 3 && <p className="auth-legal">{rich(tr('auth.legal'), {
          terms: s => <a href={legalPage('terms')} target="_blank" rel="noopener">{s}</a>,
          privacy: s => <a href={legalPage('privacy')} target="_blank" rel="noopener">{s}</a>,
        })}</p>}
        {step > 0 && <button type="button" className="auth-back" onClick={() => setStep(step - 1)} disabled={busy}>{tr('common.back')}</button>}
      </div>
      {/* Isca para robôs: invisível para pessoas e para leitores de tela. */}
      <input className="hp" tabIndex={-1} aria-hidden="true" autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} name="website" />
    </form>
  );
}

// fresh: conta acabou de ser criada (ainda não tem e-mail de recuperação, nem precisa conferir).
export function Auth({ onSession }: { onSession: (s: Session, fresh?: boolean) => void }) {
  const path = usePath();
  const mode = path === '/criar-conta' ? 'signup' : 'signin';
  const [config, setConfig] = useState<Config>({ domain: DOMAIN, turnstileSiteKey: '' });

  useEffect(() => {
    if (path !== '/entrar' && path !== '/criar-conta') navigate('/entrar', true);
  }, [path]);
  useEffect(() => { api<Config>('/auth/config').then(setConfig).catch(() => {}); }, []);
  // Entrando com mais uma conta: dá para voltar para a que estava aberta.
  const from = (() => { try { return sessionStorage.getItem('shalom-adding'); } catch { return null; } })();
  const others = accounts();
  const notice = (() => { try { const n = sessionStorage.getItem('shalom-notice'); sessionStorage.removeItem('shalom-notice'); return n; } catch { return null; } })();
  const [note] = useState(notice);

  return (
    <div className="auth" data-theme="dark">
      <PeaceBackdrop />
      <header className="auth-top">
        <a href="/" className="auth-home"><Icon name="back" size={16} />shalomail.com</a>
        {mode === 'signin'
          ? <a href="/criar-conta" onClick={go('/criar-conta')}>{tr('auth.createAccount')}</a>
          : <a href="/entrar" onClick={go('/entrar')}>{tr('auth.signIn')}</a>}
      </header>
      <main className="auth-main">
        <div className="auth-stage">
          <a href="/" className="auth-mark" aria-label="Shalom Mail"><Mark size={64} /></a>
          {note && <p className="auth-notice" role="status">{note}</p>}
          {mode === 'signin' ? <SignInForm config={config} onSession={onSession} /> : <SignUpFlow config={config} onSession={onSession} />}
          {others.length > 0 && (
            <div className="auth-accounts">
              <p>{tr(from !== null ? 'auth.orBackTo' : 'auth.accountsHere')}</p>
              {others.map(a => (
                <button key={a.slot} type="button" onClick={() => {
                  // Veio do `shalom login` ou do link dos agentes: a conta escolhida abre na mesma página.
                  let next = '/caixa/inbox';
                  try { sessionStorage.removeItem('shalom-adding'); next = sessionStorage.getItem('shalom-next') || next; sessionStorage.removeItem('shalom-next'); } catch { /* */ }
                  switchAccount(a.slot, next);
                }}>
                  <Avatar address={a.address} label={initials({ name: a.name, address: a.address })} className="avatar auth-account-avatar" />
                  <span className="auth-account-text"><strong>{a.name || a.address.split('@')[0]}</strong><span>{a.address}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
