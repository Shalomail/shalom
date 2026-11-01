// Confirmar que é você: aparece quando uma ação perigosa (apagar de vez, chaves de API, conectar o terminal,
// apagar caixa de agente) volta do servidor com "reauth". Pede a senha e o segundo fator ligado, confirma
// (vale 10 minutos nesta sessão) e o pedido original segue sozinho (lib/api.ts).
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { t as tr } from '../i18n';
import { onReauth } from '../lib/api';
import { confirmIdentity, getSecurity } from '../lib/security';
import type { User } from '../lib/session';
import { FactorFields, Labeled, Secret, factorAnswers, factorsReady, type Need } from '../screens/Profile';

const fail = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

export function Reauth({ user }: { user: User }) {
  const [ask, setAsk] = useState<{ done: (ok: boolean) => void } | null>(null);
  const [need, setNeed] = useState<Need>({ pin: false, totp: false });
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const waiting = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    // Vários pedidos ao mesmo tempo esperam a mesma confirmação.
    onReauth(() => waiting.current ??= new Promise<boolean>(resolve => {
      setPassword(''); setPin(''); setCode(''); setError(''); setBusy(false);
      getSecurity().then(s => setNeed({ pin: s.pin, totp: s.totp })).catch(() => setNeed({ pin: false, totp: false }));
      setAsk({ done: ok => { waiting.current = null; setAsk(null); resolve(ok); } });
    }));
    return () => onReauth(null);
  }, []);

  if (!ask) return null;
  const ready = !!password && factorsReady(need, pin, code);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ask || !ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await confirmIdentity(user, password, factorAnswers(need, pin, code));
      ask.done(true);
    } catch (err) { setError(fail(err, tr('common.genericError'))); setBusy(false); }
  }
  function keys(e: KeyboardEvent) {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); ask?.done(false); }
  }

  return createPortal(
    <div className="st-modal-scrim" onKeyDown={keys}>
      <form className="st-modal" role="dialog" aria-modal="true" aria-labelledby="reauth-title" onSubmit={submit}>
        <h3 id="reauth-title">{tr('reauth.title')}</h3>
        <p>{tr('reauth.text')}</p>
        <div className="reauth-fields">
          <Labeled label={tr('settings.accountPassword')}><Secret value={password} onChange={setPassword} autoComplete="current-password" autoFocus /></Labeled>
          <FactorFields need={need} pin={pin} setPin={setPin} code={code} setCode={setCode} />
        </div>
        {error && <p className="st-error" role="alert">{error}</p>}
        <div className="st-modal-actions">
          <button type="button" className="btn btn-quiet" onClick={() => ask.done(false)} disabled={busy}>{tr('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!ready || busy}>{busy ? <><span className="spinner" />{tr('reauth.go')}</> : tr('reauth.go')}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
