// Onde o CLI guarda a chave da conta e as caixas de agente: ~/.config/shalom (ou $XDG_CONFIG_HOME,
// ou %APPDATA% no Windows). Pasta só do usuário (700) e arquivos 600: a chave privada de cada caixa
// mora aqui e em nenhum outro lugar.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fromB64, toB64 } from '../../shared/seal';
import type { Agent } from './client';

export const DEFAULT_API = 'https://shalomail.com';

const base = () => process.env.SHALOM_CONFIG_DIR
  || (process.platform === 'win32' && process.env.APPDATA ? join(process.env.APPDATA, 'shalom') : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'shalom'));

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* Windows */ }
}

// Grava num arquivo ao lado e troca de nome: se o processo morrer no meio, o arquivo antigo continua inteiro.
function writePrivate(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* Windows */ }
  try { renameSync(tmp, path); } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

export class StoreError extends Error {}

// Arquivo que não existe é null. Arquivo que existe e não abre é erro: tratar como ausente faria o CLI
// criar outro por cima e perder a chave privada que estava nele.
const readJson = <T>(path: string): T | null => {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch (e) {
    throw new StoreError(`${path} exists but could not be read (${(e as Error).message}). Fix it or move it away; it was left as is.`);
  }
};

export type Config = { api?: string; accountKey?: string; account?: string; serverKeys?: Record<string, string> };

export const configPath = () => join(base(), 'config.json');
export const loadConfig = (): Config => readJson<Config>(configPath()) ?? {};
export function saveConfig(c: Config) {
  ensureDir(base());
  writePrivate(configPath(), c);
}

export const apiOf = (flag?: string) => (flag || process.env.SHALOM_API_URL || loadConfig().api || DEFAULT_API).replace(/\/+$/, '');

// Caixa de agente salva: a chave de API dela, a chave privada e as chaves fixadas dos contatos Shalom.
export type AgentFile = { address: string; id: string; name: string; api: string; key: string; secretKey: string; createdAt: number; pins?: Record<string, string> };

const agentsDir = () => join(base(), 'agents');
const agentPath = (address: string) => join(agentsDir(), `${address.toLowerCase()}.json`);

export function saveAgent(a: AgentFile) {
  ensureDir(base());
  ensureDir(agentsDir());
  writePrivate(agentPath(a.address), a);
}
export const loadAgentFile = (address: string) => readJson<AgentFile>(agentPath(address));
export const removeAgentFile = (address: string) => rmSync(agentPath(address), { force: true });
export function listAgentFiles(): AgentFile[] {
  if (!existsSync(agentsDir())) return [];
  return readdirSync(agentsDir()).filter(f => f.endsWith('.json')).flatMap(f => {
    try { return readJson<AgentFile>(join(agentsDir(), f)) ?? []; } catch (e) { process.stderr.write(`shalom: ${(e as Error).message}\n`); return []; }
  });
}
export const agentPathOf = agentPath;

// Credencial inteira de uma caixa numa linha só, para servidor, contêiner ou CI (SHALOM_AGENT_TOKEN).
const TOKEN_PREFIX = 'shalom_agent_';
export const exportToken = (a: AgentFile) =>
  TOKEN_PREFIX + Buffer.from(JSON.stringify({ a: a.address, i: a.id, n: a.name, u: a.api, k: a.key, s: a.secretKey })).toString('base64url');
export function importToken(token: string): AgentFile {
  if (!token.startsWith(TOKEN_PREFIX)) throw new Error('SHALOM_AGENT_TOKEN is not a Shalom agent token.');
  const j = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url').toString('utf8'));
  return { address: j.a, id: j.i, name: j.n, api: j.u, key: j.k, secretKey: j.s, createdAt: 0 };
}

// SHALOM_AGENT_TOKEN, ou o arquivo apontado por SHALOM_AGENT_TOKEN_FILE (melhor em servidor: segredo montado
// como arquivo vaza menos que variável de ambiente, que aparece em logs e passa para processos filhos).
export function envToken(): string | undefined {
  if (process.env.SHALOM_AGENT_TOKEN) return process.env.SHALOM_AGENT_TOKEN.trim();
  const file = process.env.SHALOM_AGENT_TOKEN_FILE;
  return file ? readFileSync(file, 'utf8').trim() : undefined;
}

// Chaves dos contatos Shalom fixadas por uma caixa que roda por token (sem arquivo da caixa): ficam em
// pins/<endereço>.json, para a troca de chave de um contato ser notada de uma execução para outra.
const pinsPath = (address: string) => join(base(), 'pins', `${address.toLowerCase()}.json`);
export const loadPins = (address: string) => readJson<Record<string, string>>(pinsPath(address)) ?? {};
export function savePins(address: string, pins: Record<string, string>) {
  try {
    ensureDir(base());
    ensureDir(join(base(), 'pins'));
    writePrivate(pinsPath(address), pins);
  } catch { /* disco só de leitura: segue com as chaves na memória */ }
}

export const toAgent = (f: AgentFile, api?: string): Agent => ({ address: f.address, key: f.key, secretKey: fromB64(f.secretKey), api: api ?? f.api });
export { toB64 };
