// shalomail.com/conectar?codigo=ABCD-2345: o `shalom login` abre esta página. A pessoa, com a conta
// aberta, confere se o código é o mesmo do terminal e conecta; o terminal recebe uma chave de API que só
// cuida das caixas de agente (worker/clilogin.ts). Sem código na URL, dá para digitar o do terminal.
import { useEffect, useState, type FormEvent } from 'react';
import { approveCli, cliRequest, denyCli, type CliRequest } from '../lib/agents';
import { Icon } from '../ui/Icon';
import { t as tr } from '../i18n';
import './settings.css';
import './agents.css';

type State = 'loading' | 'ask' | 'type' | 'busy' | 'approved' | 'denied' | 'gone';
const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).replace(/^(.{4})(.+)$/, '$1-$2');

export function ConnectCli({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState(() => clean(new URLSearchParams(location.search).get('codigo') ?? ''));
  const [req, setReq] = useState<CliRequest | null>(null);
  const [state, setState] = useState<State>(code.length === 9 ? 'loading' : 'type');
  const [typed, setTyped] = useState('');
  const [wrong, setWrong] = useState(false);

  // Código digitado que não existe volta para o campo, com o aviso; o do link vai para "venceu".
  async function look(c: string, typedIn = false) {
    setState('loading');
    try { setReq(await cliRequest(c)); setCode(c); setWrong(false); setState('ask'); } catch { if (typedIn) { setWrong(true); setState('type'); } else setState('gone'); }
  }
  useEffect(() => { if (code.length === 9) look(code); }, []);

  async function decide(yes: boolean) {
    setState('busy');
    try {
      if (yes) await approveCli(code); else await denyCli(code);
      setState(yes ? 'approved' : 'denied');
    } catch { setState('gone'); }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const c = clean(typed);
    if (c.length === 9) look(c, true);
  }

  const seconds = req ? Math.max(0, Math.round((Date.now() - req.createdAt) / 1000)) : 0;

  return (
    <main className="profile st ag">
      <div className="st-scroll ag-connect-wrap">
        <section className="ag-connect" aria-labelledby="ag-connect-title">
          <span className={`ag-connect-mark${state === 'approved' ? ' is-done' : ''}`} aria-hidden="true">
            {state === 'approved' ? <Icon name="check" size={22} /> : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7A1.5 1.5 0 0 1 5 5.5z" /><path d="M7.5 10l2.5 2-2.5 2M12 14.5h4" />
              </svg>
            )}
          </span>
          <h1 id="ag-connect-title">{tr(state === 'approved' ? 'cli.doneTitle' : state === 'denied' ? 'cli.deniedTitle' : 'cli.title')}</h1>

          {state === 'type' && (
            <form className="ag-connect-form" onSubmit={submit}>
              <p className="ag-connect-text">{tr('cli.typeCode')}</p>
              <input className="st-input ag-code-input" value={typed} onChange={e => { setTyped(clean(e.target.value)); setWrong(false); }} placeholder="ABCD-2345"
                autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} dir="ltr" aria-label={tr('cli.typeCode')}
                aria-invalid={wrong || undefined} aria-describedby={wrong ? 'ag-code-wrong' : undefined} />
              {wrong && <p className="st-error ag-note" id="ag-code-wrong" role="alert"><Icon name="alert" size={14} />{tr('cli.badCode')}</p>}
              <button className="btn btn-primary" type="submit" disabled={clean(typed).length !== 9}>{tr('cli.continue')}</button>
            </form>
          )}

          {state === 'loading' && <p className="ag-connect-text"><span className="spinner" /></p>}

          {(state === 'ask' || state === 'busy') && req && (
            <>
              <p className="ag-connect-text">{tr('cli.lead')}</p>
              <div className="ag-code" dir="ltr" aria-label={tr('cli.codeLabel')}>{req.code}</div>
              <p className="ag-connect-hint">{tr('cli.codeLabel')}</p>
              <dl className="ag-connect-meta">
                <div><dt>{tr('cli.account')}</dt><dd dir="ltr">{req.account}</dd></div>
                {req.device && <div><dt>{tr('cli.device')}</dt><dd dir="ltr">{req.device}</dd></div>}
                <div><dt>{tr('cli.when')}</dt><dd>{seconds < 60 ? tr('cli.secondsAgo', { n: seconds }) : tr('cli.minutesAgo', { n: Math.round(seconds / 60) })}</dd></div>
                <div><dt>{tr('cli.access')}</dt><dd>{tr('cli.accessText')}</dd></div>
              </dl>
              <p className="ag-connect-warn"><Icon name="alert" size={15} />{tr('cli.warn')}</p>
              <div className="ag-connect-actions">
                <button className="btn btn-quiet" disabled={state === 'busy'} onClick={() => decide(false)}>{tr('cli.deny')}</button>
                <button className="btn btn-primary" disabled={state === 'busy'} onClick={() => decide(true)}>{state === 'busy' && <span className="spinner" />}{tr('cli.approve')}</button>
              </div>
            </>
          )}

          {state === 'approved' && <p className="ag-connect-text">{tr('cli.doneText')}</p>}
          {state === 'denied' && <p className="ag-connect-text">{tr('cli.deniedText')}</p>}
          {state === 'gone' && <p className="ag-connect-text">{tr('cli.gone')}</p>}

          {(state === 'approved' || state === 'denied' || state === 'gone') && (
            <button className="btn btn-quiet ag-connect-next" onClick={onDone}>{tr('cli.toAgents')}</button>
          )}
        </section>
      </div>
    </main>
  );
}
