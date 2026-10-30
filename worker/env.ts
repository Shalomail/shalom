import type { Mailbox } from './box';

export interface Env {
  // Contas, sessões e contadores. As mensagens ficam em uma caixa (Durable Object) por conta.
  DB: D1Database;
  MAILBOX: DurableObjectNamespace<Mailbox>;
  // Freios por IP e por conta que não gravam nada no banco.
  IP_LIMIT: RateLimit;
  USER_LIMIT: RateLimit;
  BLOBS: R2Bucket;
  EMAIL: SendEmail;
  // Arquivos estáticos (landing e app). O app abre pelo app.html nas rotas dele.
  ASSETS: Fetcher;
  // Domínio dos endereços (o que vem depois do @). No dev: shalomail.com.
  MAIL_DOMAIN: string;
  APP_ORIGIN: string;
  // "on" envia de verdade pelo Email Service. Qualquer outro valor só registra no log.
  EMAIL_SENDING: string;
  // Segredos (wrangler secret put; no dev, .dev.vars).
  AUTH_PEPPER: string;
  ENVELOPE_KEY: string;
  TURNSTILE_SECRET: string;
  // Remetente lacrado: chave Ed25519 que assina os certificados (32 bytes em base64) e chave RSA
  // privada (JWK em JSON) que assina às cegas os ingressos de entrega.
  CERT_KEY: string;
  TOKEN_KEY: string;
  // Chave pública do Turnstile (vai para o navegador).
  TURNSTILE_SITEKEY: string;
  // Cadastro só com convite enquanto o serviço está em teste. Vazio ou ausente: cadastro aberto.
  SIGNUP_INVITE?: string;
  // "open" abre o cadastro mesmo com SIGNUP_INVITE definido (o convite do dono continua guardado para
  // fechar de novo só trocando esta variável).
  SIGNUP?: string;
  // Para onde vão contato@, privacidade@, abuse@ e postmaster@ (worker/mail.ts) e o resumo diário.
  FORWARD_TO?: string;
  // Tetos de envio por dia (worker/util.ts sendCaps). Sem valor: 160 no total e 100 das pessoas.
  SEND_CAP?: string;
  SEND_CAP_PEOPLE?: string;
  // "on" durante a janela da migração (docs/migracao.md): a API responde 503, menos a administração. Os
  // e-mails continuam chegando, porque o recebimento não passa pela API.
  MAINTENANCE?: string;
  // Chave das rotas de administração (/api/admin: suspender, apagar, migrar). Sem ela, as rotas não existem.
  ADMIN_KEY?: string;
  // Plano das caixas de agente (Stripe da X Tech). Sem a chave, a cobrança fica desligada e vale só o
  // plano grátis. Os preços são achados pelo lookup_key (scripts/stripe-setup.mjs).
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PORTAL_CONFIG?: string;
}

export type User = { id: string; address: string; name: string; public_key: string };

// session: hash do token da sessão deste pedido. apiKey: o tipo da chave de API, quando o pedido veio
// por ela (CLI) em vez do cookie.
export type AppEnv = { Bindings: Env; Variables: { user: User; session: string; apiKey?: 'account' | 'agent'; apiKeyHash?: string } };
