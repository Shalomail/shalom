// Agentes de IA, numa página própria (fora das Configurações do e-mail): quanto do plano está em uso,
// as caixas criadas, como começar pelo terminal, as chaves de API e os planos. As caixas nascem pelo
// CLI; aqui a pessoa acompanha, apaga, cria chave e assina. A volta do Checkout do Stripe chega com
// ?sessao= e o plano é gravado na hora.
import { useEffect, useState } from 'react';
import {
  billingInfo, billingPortal, checkout, createKey, deleteAgent, docsHref, listAgents, listKeys, revokeKey, syncCheckout,
  type AgentBox, type ApiKey, type Billing, type PaidPlan,
} from '../lib/agents';
import { dayMonthYear } from '../lib/format';
import { Icon } from '../ui/Icon';
import { t as tr, useLocale } from '../i18n';
import './settings.css';
import './agents.css';

const fail = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function CopyIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 8.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5V10a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M15 8.5v-3A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5H9" />
    </svg>
  );
}

// Terminal: o sinal de prompt e o cursor, no mesmo traço do Icon.
function TerminalIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7A1.5 1.5 0 0 1 5 5.5z" />
      <path d="M7.5 10l2.5 2-2.5 2M12 14.5h4" />
    </svg>
  );
}

// Comando com o botão de copiar.
function Cmd({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ag-cmd" dir="ltr">
      <span className="ag-cmd-prompt" aria-hidden="true">$</span>
      <code>{text}</code>
      <button type="button" className="ag-cmd-copy" aria-label={tr('common.copy')}
        onClick={async () => { if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }}>
        {copied ? <Icon name="check" size={14} /> : <CopyIcon size={14} />}
      </button>
    </div>
  );
}

// O final da chave isolado da direção da frase: em hebraico e árabe, "_ESM" saía como "ESM_".
const ltr = (s: string) => `\u2066${s}\u2069`;

// Exemplo de nome que dá para usar de verdade: o da pessoa com -bot (support e suporte são reservados).
const exampleOf = (address: string) => `${address.split('@')[0].slice(0, 28).replace(/[._-]+$/, '')}-bot`;

export function AgentsPage({ address, onBack }: { address: string; onBack: () => void }) {
  const locale = useLocale();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [agents, setAgents] = useState<AgentBox[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = () => Promise.all([billingInfo().then(setBilling), listAgents().then(setAgents)]).catch(e => setError(fail(e, tr('mailbox.loadFail'))));
  useEffect(() => {
    const session = new URLSearchParams(location.search).get('sessao');
    (async () => {
      if (session) {
        history.replaceState(null, '', location.pathname);
        try { await syncCheckout(session); setNote(tr('settings.agents.activated')); } catch (e) { setError(fail(e, tr('settings.agents.payFail'))); }
      }
      await load();
    })();
  }, []);

  async function choose(plan: PaidPlan) {
    setBusy(plan);
    setError('');
    setNote('');
    try {
      const r = await checkout(plan);
      if (r.url) { location.href = r.url; return; }
      setNote(tr('settings.agents.changed'));
      await load();
    } catch (e) { setError(fail(e, tr('settings.agents.payFail'))); }
    setBusy(null);
  }
  async function manage() {
    setBusy('portal');
    setError('');
    try { location.href = await billingPortal(); return; } catch (e) { setError(fail(e, tr('settings.agents.payFail'))); }
    setBusy(null);
  }
  async function remove(id: string) {
    setAsking(null);
    setBusy(id);
    setError('');
    try { await deleteAgent(id); await load(); } catch (e) { setError(fail(e, tr('settings.agents.deleteFail'))); }
    setBusy(null);
  }
  const toPlans = () => document.getElementById('ag-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const usd = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
  const full = !!billing && billing.limit !== null && billing.used >= billing.limit;
  const usage = (b: Billing) => (b.limit === null ? tr('agents.usageUnlimited', { used: b.used }) : tr('settings.agents.usage', { used: b.used, limit: b.limit }));
  const hasAgents = !!agents && agents.length > 0;

  const start = (
    <section className="ag-sec" aria-labelledby="ag-start">
      <h2 id="ag-start">{tr('settings.agents.start')}</h2>
      <ol className="ag-steps">
        {[['settings.agents.step1', 'npm install -g shalomail'], ['settings.agents.step2', 'shalom login'], ['settings.agents.step3', `shalom agents create ${exampleOf(address)}`]].map(([label, cmd], i) => (
          <li key={cmd}>
            <span className="ag-step-num" aria-hidden="true">{i + 1}</span>
            <div className="ag-step-main">
              <p>{tr(label as 'settings.agents.step1')}</p>
              <Cmd text={cmd} />
            </div>
          </li>
        ))}
      </ol>
      <a className="ag-link" href={docsHref(locale)} target="_blank" rel="noopener">{tr('settings.agents.docs')}<Icon name="arrow" size={14} /></a>
    </section>
  );

  const boxes = hasAgents && (
    <section className="ag-sec" aria-labelledby="ag-boxes">
      <h2 id="ag-boxes">{tr('agents.boxes')}</h2>
      <ul className="ag-boxes">
        {agents!.map(a => (
          <li key={a.id}>
            <span className="ag-box-tile" aria-hidden="true"><TerminalIcon size={17} /></span>
            <span className="ag-box-text">
              <strong dir="ltr">{a.address}</strong>
              <span>{[a.name, tr('settings.agents.createdOn', { date: dayMonthYear(new Date(a.createdAt)) })].filter(Boolean).join(' · ')}</span>
            </span>
            <span className={`ag-state${a.paused ? ' is-paused' : ''}`} title={a.paused ? tr('settings.agents.pausedDesc') : undefined}>
              {tr(a.paused ? 'agents.paused' : 'agents.active')}
            </span>
            {asking === a.id ? (
              <span className="ag-confirm">
                <button className="st-btn st-btn-quiet" onClick={() => setAsking(null)}>{tr('common.cancel')}</button>
                <button className="st-btn is-danger" onClick={() => remove(a.id)}>{tr('settings.agents.deleteYes')}</button>
              </span>
            ) : (
              <button className="st-btn st-btn-quiet" disabled={busy === a.id} onClick={() => setAsking(a.id)}>{busy === a.id && <span className="spinner" />}{tr('settings.agents.delete')}</button>
            )}
          </li>
        ))}
      </ul>
      {asking && <p className="ag-note">{tr('settings.agents.deleteAsk')}</p>}
    </section>
  );

  return (
    <main className="profile st ag">
      <div className="st-scroll">
        <div className="st-page ag-page">
          <header className="st-top">
            <button className="icon-btn only-mobile st-back" onClick={onBack} aria-label={tr('settings.backToInbox')}><Icon name="back" /></button>
            <h1>{tr('agents.title')}</h1>
          </header>
          <p className="ag-lead">{tr('settings.agents.desc')}</p>

          <div className={`ag-usage${full ? ' is-full' : ''}`}>
            <div className="ag-usage-text">
              <p className="ag-usage-plan">{billing ? tr('agents.planName', { name: tr(`settings.agents.${billing.plan}`) }) : tr('common.loading')}</p>
              <p className="ag-usage-count">
                {billing ? usage(billing) : ' '}
                {billing?.subscribed && billing.periodEnd ? ` · ${tr('settings.agents.renews', { date: dayMonthYear(new Date(billing.periodEnd)) })}` : ''}
              </p>
            </div>
            {billing?.limit === null ? <span className="ag-meter-none" aria-hidden="true" /> : (
              <div className="ag-meter" role="progressbar" aria-valuemin={0} aria-valuemax={billing?.limit ?? 2} aria-valuenow={billing?.used ?? 0}
                aria-label={billing ? usage(billing) : undefined}>
                <span style={{ width: billing?.limit ? `${Math.min(100, (billing.used / billing.limit) * 100)}%` : '0%' }} />
              </div>
            )}
            {billing?.subscribed
              ? <button className="st-btn" onClick={manage} disabled={!!busy}>{busy === 'portal' && <span className="spinner" />}{tr('settings.agents.manage')}</button>
              : <button className="st-btn" onClick={toPlans}>{tr('agents.seePlans')}</button>}
          </div>
          {note && <p className="st-done ag-note" role="status"><Icon name="check" size={14} />{note}</p>}
          {error && <p className="st-error ag-note">{error}</p>}

          {hasAgents ? <>{boxes}{start}</> : start}

          <section className="ag-sec" aria-labelledby="ag-keys">
            <h2 id="ag-keys">{tr('settings.api.title')}</h2>
            <p className="ag-sec-desc">{tr('settings.api.desc')}</p>
            <ApiKeys />
          </section>

          <section className="ag-sec" id="ag-plans" aria-labelledby="ag-plans-title">
            <h2 id="ag-plans-title">{tr('agents.plans')}</h2>
            {billing && (
              <ul className="ag-plans">
                {([
                  ['free', tr('settings.agents.boxes', { n: 2 }), tr('settings.agents.freePrice')],
                  ['agents5', tr('settings.agents.boxes', { n: 5 }), tr('settings.agents.perMonth', { price: usd(billing.prices.agents5) })],
                  ['agents12', tr('settings.agents.boxes', { n: 12 }), tr('settings.agents.perMonth', { price: usd(billing.prices.agents12) })],
                  ['unlimited', tr('agents.unlimitedBoxes'), tr('settings.agents.perMonth', { price: usd(billing.prices.unlimited) })],
                ] as const).map(([id, boxes, price]) => {
                  const current = billing.plan === id;
                  return (
                    <li key={id} className={current ? 'is-current' : undefined}>
                      <span className="ag-plan-mark" aria-hidden="true">{current && <Icon name="check" size={13} />}</span>
                      <span className="ag-plan-text">
                        <strong>{tr(`settings.agents.${id}`)}</strong>
                        <span>{boxes}</span>
                      </span>
                      <span className="ag-plan-price">{price}</span>
                      <span className="ag-plan-action">
                        {current ? <span className="ag-plan-tag">{tr('settings.agents.current')}</span>
                          : id !== 'free' && (
                            <button className="st-btn" disabled={!billing.enabled || !!busy} onClick={() => choose(id)}>
                              {busy === id && <span className="spinner" />}{tr(billing.subscribed ? 'settings.agents.change' : 'settings.agents.choose')}
                            </button>
                          )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {billing && !billing.enabled && <p className="ag-note">{tr('settings.agents.soon')}</p>}
          </section>
        </div>
      </div>
    </main>
  );
}

// Chaves de API do CLI. A chave inteira só aparece na criação; a lista mostra o final dela.
function ApiKeys() {
  const [list, setList] = useState<ApiKey[] | null>(null);
  const [fresh, setFresh] = useState<{ key: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { listKeys().then(setList).catch(() => setList([])); }, []);

  async function make() {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      setFresh(await createKey('CLI'));
      setList(await listKeys());
    } catch (e) { setError(fail(e, tr('settings.api.fail'))); }
    setBusy(false);
  }
  async function revoke(id: string) {
    setAsking(null);
    // Revogou a que acabou de criar: o aviso com a chave inteira some junto.
    if (fresh?.id === id) setFresh(null);
    setList(l => l && l.filter(k => k.id !== id));
    await revokeKey(id).catch(() => listKeys().then(setList).catch(() => {}));
  }

  return (
    <>
      {list && list.length > 0 && (
        <ul className="ag-keys">
          {list.map(k => (
            <li key={k.id}>
              <span className={`ag-key-dot${k.lastUsed ? '' : ' is-idle'}`} aria-hidden="true" />
              <span className="ag-box-text">
                <strong>{k.name && k.name !== 'CLI' ? k.name : tr('settings.api.endsWith', { hint: ltr(k.hint) })}</strong>
                <span>{[k.name && k.name !== 'CLI' ? `…${ltr(k.hint)}` : '', tr('settings.api.createdOn', { date: dayMonthYear(new Date(k.createdAt)) }), k.lastUsed ? tr('settings.api.usedOn', { date: dayMonthYear(new Date(k.lastUsed)) }) : tr('settings.api.neverUsed')].filter(Boolean).join(' · ')}</span>
              </span>
              {asking === k.id ? (
                <span className="ag-confirm">
                  <button className="st-btn st-btn-quiet" onClick={() => setAsking(null)}>{tr('common.cancel')}</button>
                  <button className="st-btn is-danger" onClick={() => revoke(k.id)}>{tr('settings.api.revoke')}</button>
                </span>
              ) : (
                <button className="st-btn st-btn-quiet" onClick={() => setAsking(k.id)}>{tr('settings.api.revoke')}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {fresh && (
        <div className="ag-fresh" role="status">
          <p className="ag-fresh-title">{tr('settings.api.ready')}</p>
          <p className="ag-fresh-note">{tr('settings.api.readyNote')}</p>
          <div className="ag-fresh-row">
            <input className="st-input ag-key" readOnly value={fresh.key} dir="ltr" onFocus={e => e.target.select()} aria-label={tr('settings.api.ready')} />
            <button className="st-btn st-btn-icon" onClick={async () => { if (await copyText(fresh.key)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }}>
              {copied ? <><Icon name="check" size={15} />{tr('settings.api.copied')}</> : <><CopyIcon />{tr('common.copy')}</>}
            </button>
          </div>
        </div>
      )}
      {error && <p className="st-error ag-note">{error}</p>}
      <div className="ag-keys-foot">
        <button className="st-btn" onClick={make} disabled={busy}>{busy ? <><span className="spinner" />{tr('settings.api.creating')}</> : tr('settings.api.new')}</button>
        <span className="ag-note">{tr('agents.keysHint')}</span>
      </div>
    </>
  );
}
