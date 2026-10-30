// Foto da conta no canto de cima. Abre um cartão da conta: quem está aberto, as configurações,
// as outras contas deste navegador, entrar com mais uma e sair.
import { useEffect, useRef, useState } from 'react';
import { accounts } from '../lib/accounts';
import { currentSlot } from '../lib/api';
import { initials } from '../lib/format';
import { addAccount, switchAccount, type User } from '../lib/session';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { t } from '../i18n';

export function AccountMenu({ user, avatarV, onSettings, onAgents, onSignOut }: {
  user: User;
  avatarV: number;
  onSettings: () => void;
  onAgents: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const others = open ? accounts().filter(a => a.slot !== currentSlot()) : [];
  const first = (user.name || user.address.split('@')[0]).split(/\s+/)[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const label = (name: string, address: string) => initials({ name, address });

  return (
    <div className="acct" ref={box}>
      <button className="acct-btn" onClick={() => { setOpen(!open); setFull(false); }} aria-expanded={open} aria-haspopup="dialog"
        aria-label={t('account.button', { address: user.address })}>
        <Avatar address={user.address} label={label(user.name, user.address)} version={avatarV} className="avatar acct-avatar" />
      </button>
      {open && (
        <div className="acct-card" role="dialog" aria-label={t('account.card')}>
          <div className="acct-me">
            <p className="acct-address">{user.address}</p>
            <Avatar address={user.address} label={label(user.name, user.address)} version={avatarV} className="avatar acct-me-avatar" />
            <p className="acct-hello">{t('account.hello', { name: first })}</p>
            <button className="acct-settings" onClick={() => { setOpen(false); onSettings(); }}>
              <Icon name="settings" size={16} />{t('account.settings')}
            </button>
          </div>
          <div className="acct-list">
            {others.map(a => (
              <button key={a.slot} className="acct-row" onClick={() => switchAccount(a.slot)}>
                <Avatar address={a.address} label={label(a.name, a.address)} className="avatar acct-row-avatar" />
                <span className="acct-row-text"><strong>{a.name || a.address.split('@')[0]}</strong><span>{a.address}</span></span>
              </button>
            ))}
            <button className="acct-row" onClick={() => { setOpen(false); onAgents(); }}>
              <span className="acct-row-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7A1.5 1.5 0 0 1 5 5.5z" /><path d="M7.5 10l2.5 2-2.5 2M12 14.5h4" />
                </svg>
              </span>
              <span className="acct-row-text"><strong>{t('account.agents')}</strong></span>
            </button>
            <button className="acct-row" onClick={() => { if (!addAccount()) setFull(true); }}>
              <span className="acct-row-icon"><Icon name="plus" size={18} /></span>
              <span className="acct-row-text"><strong>{t('account.add')}</strong></span>
            </button>
            {full && <p className="acct-note">{t('account.full')}</p>}
            <button className="acct-row" onClick={() => { setOpen(false); onSignOut(); }}>
              <span className="acct-row-icon"><Icon name="logout" size={18} /></span>
              <span className="acct-row-text"><strong>{t('account.signOut')}</strong>{others.length > 0 && <span>{t('account.onlyThis')}</span>}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
