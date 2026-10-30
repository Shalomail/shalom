// Texto com pedaços que viram elemento: "Não existe conta {address}. <link>Criar com esse endereço</link>".
// Cada idioma põe as marcas onde a frase pede; quem chama diz o que cada marca vira.
import { Fragment, type ReactNode } from 'react';

export function rich(text: string, tags: Record<string, (chunk: string) => ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const make = tags[m[1]];
    out.push(<Fragment key={m.index}>{make ? make(m[2]) : m[2]}</Fragment>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
