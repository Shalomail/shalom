// Antes de abrir a caixa: confere o navegador (lib/browser-check). Limpo, passa sozinho em menos de um
// segundo, com cada conferência marcando o visto. Com sinal de espião, para e mostra o que achou, com a
// saída mais segura primeiro e a opção de abrir mesmo assim.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CHECKS, runBrowserCheck, trust, type CheckId, type Finding } from '../lib/browser-check';
import { Icon } from '../ui/Icon';
import { t } from '../i18n';
import './browser-check.css';

// O que cada conferência diz quando passa e quando acha algo (bc.label e bc.found nos dicionários).
const label = (id: CheckId) => t(`bc.label.${id}`);
const found = (id: CheckId) => t(`bc.found.${id}`);

// Cada estação leva um instante para ser lida; a checagem de verdade termina antes.
const STEP_MS = 170;

export function BrowserCheck({ onPass, onSignOut }: { onPass: () => void; onSignOut: () => void }) {
  const [done, setDone] = useState(0);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [remember, setRemember] = useState(false);
  const [round, setRound] = useState(0);
  const passRef = useRef(onPass);
  passRef.current = onPass;

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = reduced ? 0 : STEP_MS;
    setDone(0);
    setFindings(null);
    const run = runBrowserCheck();
    const timers = CHECKS.map((_, i) => window.setTimeout(() => setDone(i + 1), step * (i + 1)));
    // Fecha a vigia depois do último visto: o que chegar até ali também conta.
    const end = window.setTimeout(() => {
      const found = run.stop();
      if (!found.length) { window.setTimeout(() => passRef.current(), reduced ? 0 : 420); return; }
      setFindings(found);
    }, step * CHECKS.length + 80);
    return () => { timers.forEach(clearTimeout); clearTimeout(end); run.stop(); };
  }, [round]);

  if (findings) {
    const canTrust = findings.every(f => f.trustable);
    const open = () => {
      if (remember && canTrust) trust(findings.flatMap(f => f.keys));
      onPass();
    };
    // Uma linha por coisa encontrada: extensão com nome, o que faz e o sinal que deixou; o resto com o
    // título da conferência que pegou e o detalhe.
    const rows = findings.flatMap(f => f.entries
      ? f.entries.map(e => ({ key: e.key, tile: e.name.slice(0, 1), name: e.name, notes: [e.note], mark: e.mark }))
      : [{ key: f.id, tile: '', name: found(f.id as CheckId), notes: f.items, mark: '' }]);
    return (
      <main className="bc">
        <section className="bc-sheet" role="alert" aria-labelledby="bc-title">
          <p className="bc-kicker"><Icon name="alert" size={15} />{t('bc.kicker')}</p>
          <h1 id="bc-title" className="bc-title">{t('bc.warnTitle')}</h1>
          <p className="bc-text">{t('bc.warnLede')}</p>
          <ul className="bc-rows">
            {rows.map(r => (
              <li key={r.key}>
                <span className={`bc-tile${r.tile ? '' : ' is-alert'}`} aria-hidden="true">{r.tile || <Icon name="alert" size={16} />}</span>
                <div className="bc-row-text">
                  <p className="bc-row-name">{r.name}</p>
                  {r.notes.map(n => <p key={n} className="bc-row-note">{n}</p>)}
                  {r.mark && <p className="bc-row-mark">{t('bc.markLabel')} <span dir="ltr">{r.mark}</span></p>}
                </div>
              </li>
            ))}
          </ul>
          <p className="bc-tip">{t('bc.advice')}</p>
          <div className="bc-foot">
            {canTrust && (
              <label className="bc-remember">
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                {t('bc.remember')}
              </label>
            )}
            <div className="bc-buttons">
              <button className="btn btn-quiet" onClick={open}>{t('bc.openAnyway')}</button>
              <button className="btn btn-primary" onClick={() => setRound(r => r + 1)}>{t('bc.again')}</button>
            </div>
          </div>
          <p className="bc-fine">{t('bc.limit')} <button className="bc-out" onClick={onSignOut}>{t('bc.signOut')}</button></p>
        </section>
      </main>
    );
  }

  // Linha de estações: o escudo se desenha na entrada; no cartão, o trilho se preenche de uma conferência
  // até a seguinte e cada estação ganha o visto. Quando a última passa, o escudo fica verde com o visto e
  // a confirmação aparece embaixo. Nada pisca nem pulsa.
  const complete = done === CHECKS.length;
  const progress = Math.max(0, done - 1) / (CHECKS.length - 1);
  return (
    <main className="bc" aria-busy="true">
      <div className={`bc-stage${complete ? ' is-done' : ''}`}>
        <svg className="bc-shield" viewBox="0 0 64 72" width="56" height="63" aria-hidden="true">
          <path className="bc-shield-line" pathLength={1} d="M32 4C40 9 48 11 58 11V34C58 52 46 62 32 68C18 62 6 52 6 34V11C16 11 24 9 32 4Z" />
          <path className="bc-shield-check" pathLength={1} d="M21 36L29 44L44 28" />
        </svg>
        <h1>{t('bc.title')}</h1>
        <p className="bc-lede">{t('bc.lede')}</p>
        <ol className="bc-rail" style={{ '--bc-progress': progress } as CSSProperties}>
          {CHECKS.map((id, i) => (
            <li key={id} className={i < done ? 'is-ok' : i === done ? 'is-now' : ''}>
              <span className="bc-node" aria-hidden="true"><Icon name="check" size={12} /></span>
              <span className="bc-step">{label(id)}</span>
            </li>
          ))}
        </ol>
        <p className="bc-clear" aria-live="polite">{complete ? t('bc.allClear') : ''}</p>
      </div>
    </main>
  );
}
