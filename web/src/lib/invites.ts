// Convites que a conta cria para trazer alguém (worker/profile.ts). O código só existe na criação: a
// lista mostra quando cada um foi criado e se já foi usado, sem dizer por quem.
import { api } from './api';

export type Invite = { id: string; createdAt: number; usedAt: number | null };

export const listInvites = () => api<{ invites: Invite[] }>('/profile/invites').then(r => r.invites);
export const createInvite = () => api<{ code: string; id: string; createdAt: number }>('/profile/invites', { body: {} });
export const revokeInvite = (id: string) => api('/profile/invites/revoke', { body: { id } });
export const inviteLink = (code: string) => `${location.origin}/criar-conta?convite=${encodeURIComponent(code)}`;
