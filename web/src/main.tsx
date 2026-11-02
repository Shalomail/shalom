import '@fontsource-variable/geist';
import './styles.css';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initLocale, useLocale } from './i18n';
import { currentAccount } from './lib/accounts';
import { forgetCache } from './lib/mailbox';
import { getRecovery } from './lib/recovery';
import { navigate, usePath } from './lib/router';
import { dropCurrent, restore, signOut, type Session } from './lib/session';
import { applyTheme } from './lib/theme';
import { Auth } from './screens/Auth';
import { BrowserCheck } from './screens/BrowserCheck';
import { Mailbox } from './screens/Mailbox';
import { ConfirmRecovery, RecoveryGate, ResetPassword } from './screens/Recovery';
import { PeaceBackdrop } from './ui/PeaceBackdrop';
import { Mark } from './ui/Icon';

applyTheme();

// Luz ambiente atrás do vidro: sem ela o liquid glass não tem o que refratar.
function Ambient() {
  return <div className="ambient" aria-hidden="true"><i /><i /><i /></div>;
}

// Carregamento logo depois de entrar ou criar a conta: o mesmo fundo claro das telas de entrar, sem
// passar por uma tela preta antes da próxima pergunta.
function AuthLoading() {
  return (
    <div className="auth" data-theme="light">
      <PeaceBackdrop />
      <main className="auth-main"><div className="auth-stage"><span className="auth-mark" aria-hidden="true"><Mark size={64} /></span></div></main>
    </div>
  );
}

function App() {
  // Trocar o idioma em Configurações desenha o app inteiro de novo, já no idioma novo.
  useLocale();
  const path = usePath();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Conta sem e-mail de recuperação: pergunta antes de mostrar a caixa (null = ainda conferindo).
  const [needsRecovery, setNeedsRecovery] = useState<boolean | null>(null);
  // Checagem do navegador: roda a cada vez que a caixa vai abrir (nova página ou outra conta).
  const [checked, setChecked] = useState(false);
  const live = useRef(false);
  live.current = !!session;
  const userRef = useRef<string | null>(null);
  userRef.current = session?.user.id ?? null;

  useEffect(() => { restore().then(setSession); }, []);
  useEffect(() => { setChecked(false); }, [session?.user.id]);
  useEffect(() => {
    if (!session) { setNeedsRecovery(null); return; }
    getRecovery().then(r => setNeedsRecovery(!r.hint)).catch(() => setNeedsRecovery(n => n ?? false));
  }, [session?.user.id]);
  useEffect(() => {
    // Sessão que acabou no servidor no meio do uso. Antes de entrar não há nada para derrubar.
    // Recarrega a página: nada desta conta (chave, certificado, ingressos, cache) fica na memória.
    const out = async () => {
      if (!live.current) return;
      live.current = false;
      await dropCurrent();
      location.assign('/entrar');
    };
    // Outra aba saiu desta vaga ou entrou nela com outra conta: esta aba recarrega, em vez de seguir
    // mostrando a caixa de uma conta com a chave de outra.
    const moved = (e: StorageEvent) => {
      if (e.key !== 'shalom-accounts' || !userRef.current) return;
      if (currentAccount()?.id !== userRef.current) location.reload();
    };
    window.addEventListener('shalom:signed-out', out);
    window.addEventListener('storage', moved);
    return () => { window.removeEventListener('shalom:signed-out', out); window.removeEventListener('storage', moved); };
  }, []);

  // Recém-saída da tela de entrar: até saber se falta o e-mail de recuperação, o carregamento é claro.
  const [fromAuth, setFromAuth] = useState(false);
  const enter = (s: Session, fresh?: boolean) => {
    try { sessionStorage.removeItem('shalom-adding'); } catch { /* sem armazenamento */ }
    setFromAuth(true);
    // Conta criada agora não tem e-mail de recuperação: vai direto para a pergunta.
    if (fresh) setNeedsRecovery(true);
    setSession(s);
    let next = '/caixa/inbox';
    try { next = sessionStorage.getItem('shalom-next') || next; sessionStorage.removeItem('shalom-next'); } catch { /* sem armazenamento */ }
    navigate(next, true);
  };


  // Links que chegam por e-mail abrem com ou sem conta aberta.
  if (path.startsWith('/confirmar')) return <ConfirmRecovery />;
  if (path.startsWith('/nova-senha')) return <ResetPassword onSession={enter} />;

  if (session === undefined) {
    // Na tela de entrar sem conta aberta nesta vaga, nada a esperar: mostra já, sem o logo de
    // carregamento piscando entre a página inicial e o formulário.
    if (/^\/(entrar|criar-conta)/.test(path) && !currentAccount()) return <Auth onSession={enter} />;
    return <div className="splash"><Mark size={44} /></div>;
  }
  if (!session) {
    // Quem chega pelo `shalom login` (ou pelo link dos agentes) sem conta aberta volta para a mesma página.
    if (/^\/(conectar|agentes-ia)/.test(path)) {
      try { sessionStorage.setItem('shalom-next', path + location.search); } catch { /* sem armazenamento */ }
    }
    return <Auth onSession={enter} />;
  }
  if (needsRecovery === null) return fromAuth ? <AuthLoading /> : <div className="splash"><Mark size={44} /></div>;
  // Sair sempre recarrega a página, para nada da conta (chave, certificado de remetente, ingressos,
  // cache) seguir na memória. Saída por inatividade fica na mesma vaga: entrar de novo volta para ela,
  // sem tomar a vaga de outra conta aberta.
  const leave = async (why?: string) => {
    const next = await signOut(!why);
    forgetCache();
    if (why) try { sessionStorage.setItem('shalom-notice', why); } catch { /* */ }
    location.assign(next && !why ? '/caixa/inbox' : '/entrar');
  };
  if (needsRecovery) return <RecoveryGate session={session} onDone={() => setNeedsRecovery(false)} onSignOut={() => leave()} />;
  if (!checked) return <BrowserCheck onPass={() => setChecked(true)} onSignOut={() => leave()} />;
  return <Mailbox session={session} onUser={user => setSession(s => (s ? { ...s, user } : s))} onSignOut={leave} />;
}

// O idioma (e a direção da página) fica pronto antes do primeiro quadro.
initLocale().finally(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><Ambient /><App /></StrictMode>);
});
