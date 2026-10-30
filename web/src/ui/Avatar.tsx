// Foto da conta Shalom quando existe; senão, as iniciais. Endereço de fora nem pergunta (não tem foto
// aqui). A busca vai sem cookie: o servidor não liga a sessão a quem aparece na sua caixa.
import { useEffect, useState } from 'react';
import { avatarUrl } from '../lib/profile';
import { DOMAIN } from '../lib/session';

const cache = new Map<string, Promise<string | null>>();

function load(url: string): Promise<string | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(r => (r.status === 200 ? r.blob().then(b => (b.size ? URL.createObjectURL(b) : null)) : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

export function Avatar({ address, label, version, className = 'avatar' }: { address?: string | null; label: string; version?: number | string; className?: string }) {
  const url = address && address.toLowerCase().endsWith(`@${DOMAIN}`) ? avatarUrl(address, version) : null;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (url) load(url).then(s => { if (alive) setSrc(s); });
    return () => { alive = false; };
  }, [url]);
  if (src) return <span className={`${className} has-photo`}><img src={src} alt="" /></span>;
  return <span className={className}>{label}</span>;
}
