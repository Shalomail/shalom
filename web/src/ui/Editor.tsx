// Editor do e-mail: um campo editável com formatação básica (negrito, itálico, sublinhado, marca-texto,
// cor e lista), foto colada ou arrastada entrando no próprio texto e arquivo virando anexo. Colar texto
// cola só o texto, sem a formatação de outro site. O HTML que sai passa por clean(): só as marcas e os
// estilos que a barra cria, e imagem só a que foi colada aqui (vira cid: no envio).
import { forwardRef, useImperativeHandle, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Icon } from './Icon';
import { t as tr } from '../i18n';

export type EditorHandle = {
  focus: () => void;
  html: (cidOf: (url: string) => string | null) => string;
  text: () => string;
  insertImage: (url: string) => void;
  empty: () => boolean;
  setHtml: (html: string) => void;
};

const COLORS = ['#d92d20', '#e8590c', '#1d8a62', '#1971c2', '#7048e8'];
const MARKS = ['#fff3a3', '#d3f9d8', '#d0ebff', '#ffdeeb'];
const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'A', 'IMG', 'FONT']);
const STYLES = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line'];

// Copia só o que a barra produz. Qualquer outra marca vira o texto dela; atributos somem. imgSrc diz o
// endereço que cada imagem leva (ou null, e ela sai).
function clean(root: HTMLElement, imgSrc: (url: string) => string | null): string {
  const out = document.createElement('div');
  const walk = (from: Node, to: Node) => {
    for (const n of Array.from(from.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) { to.appendChild(document.createTextNode(n.textContent ?? '')); continue; }
      if (!(n instanceof HTMLElement)) continue;
      if (!TAGS.has(n.tagName)) { walk(n, to); continue; }
      if (n.tagName === 'IMG') {
        const src = imgSrc(n.getAttribute('src') ?? '');
        if (src) {
          const img = document.createElement('img');
          img.src = src;
          img.alt = '';
          img.setAttribute('style', 'max-width:100%;height:auto');
          to.appendChild(img);
        }
        continue;
      }
      const tag = n.tagName === 'FONT' ? 'SPAN' : n.tagName;
      const el = document.createElement(tag);
      const style = STYLES.map(p => [p, n.style.getPropertyValue(p)] as const).filter(([, v]) => v && !/url\(|expression/i.test(v));
      if (n.tagName === 'FONT' && n.getAttribute('color')) style.push(['color', n.getAttribute('color')!]);
      if (style.length) el.setAttribute('style', style.map(([p, v]) => `${p}:${v}`).join(';'));
      if (tag === 'A') {
        const href = n.getAttribute('href') ?? '';
        if (/^(https?:|mailto:)/i.test(href)) el.setAttribute('href', href);
      }
      to.appendChild(el);
      walk(n, el);
    }
  };
  walk(root, out);
  return out.innerHTML;
}

type Props = {
  placeholder: string;
  label: string;
  compact?: boolean;
  onInput: () => void;
  onFiles: (files: File[], inline: boolean) => void;
};

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ placeholder, label, compact, onInput, onFiles }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [pop, setPop] = useState<'color' | 'mark' | null>(null);
  const [drop, setDrop] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: () => box.current?.focus(),
    html: cidOf => (box.current ? clean(box.current, url => { const cid = cidOf(url); return cid ? `cid:${cid}` : null; }) : ''),
    text: () => box.current?.innerText.replace(/\n{3,}/g, '\n\n').trim() ?? '',
    insertImage: url => { box.current?.focus(); document.execCommand('insertImage', false, url); onInput(); },
    empty: () => !box.current?.innerText.trim() && !box.current?.querySelector('img'),
    // Rascunho reaberto: o HTML passa pela mesma limpeza (num documento inerte, sem rodar nada) antes de entrar
    // na página. Só ficam as imagens do próprio rascunho (blob: criado aqui).
    setHtml: html => {
      if (!box.current) return;
      box.current.innerHTML = clean(new DOMParser().parseFromString(html, 'text/html').body, url => (url.startsWith('blob:') ? url : null));
      onInput();
    },
  }), [onInput]);

  // Estilo em span com CSS (não <font>): é o que os leitores de e-mail entendem melhor.
  const run = (cmd: string, value?: string) => {
    box.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, value);
    setPop(null);
    onInput();
  };

  function paste(e: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length) { e.preventDefault(); onFiles(files, true); return; }
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }

  function dropped(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrop(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files, true);
  }

  return (
    <div className={`editor${drop ? ' is-drop' : ''}`}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrop(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false); }}
      onDrop={dropped}>
      <div ref={box} className={`composer-body editor-area${compact ? ' is-compact' : ''}`} contentEditable role="textbox" aria-multiline="true"
        aria-label={label} data-placeholder={placeholder} spellCheck onInput={onInput} onPaste={paste} suppressContentEditableWarning />
      {drop && <div className="editor-drop" aria-hidden="true"><Icon name="clip" size={18} />{tr('composer.dropHere')}</div>}
      <div className="editor-bar" role="toolbar" aria-label={tr('composer.format')}>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => run('bold')} aria-label={tr('composer.bold')} data-tip={tr('composer.bold')} className="tip-up"><b>B</b></button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => run('italic')} aria-label={tr('composer.italic')} data-tip={tr('composer.italic')} className="tip-up"><i>I</i></button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => run('underline')} aria-label={tr('composer.underline')} data-tip={tr('composer.underline')} className="tip-up"><u>U</u></button>
        <span className="editor-pop">
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setPop(pop === 'mark' ? null : 'mark')} aria-expanded={pop === 'mark'}
            aria-label={tr('composer.highlight')} data-tip={pop ? undefined : tr('composer.highlight')} className="tip-up">
            <span className="editor-mark">A</span>
          </button>
          {pop === 'mark' && (
            <span className="editor-swatches" role="menu">
              {MARKS.map(c => <button key={c} type="button" role="menuitem" onMouseDown={e => e.preventDefault()} onClick={() => run('hiliteColor', c)} style={{ background: c }} aria-label={c} />)}
              <button type="button" role="menuitem" className="is-none" onMouseDown={e => e.preventDefault()} onClick={() => run('hiliteColor', 'transparent')} aria-label={tr('composer.noHighlight')} />
            </span>
          )}
        </span>
        <span className="editor-pop">
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setPop(pop === 'color' ? null : 'color')} aria-expanded={pop === 'color'}
            aria-label={tr('composer.color')} data-tip={pop ? undefined : tr('composer.color')} className="tip-up">
            <span className="editor-color">A</span>
          </button>
          {pop === 'color' && (
            <span className="editor-swatches" role="menu">
              {COLORS.map(c => <button key={c} type="button" role="menuitem" onMouseDown={e => e.preventDefault()} onClick={() => run('foreColor', c)} style={{ background: c }} aria-label={c} />)}
              <button type="button" role="menuitem" className="is-default" onMouseDown={e => e.preventDefault()} onClick={() => run('removeFormat')} aria-label={tr('composer.defaultColor')} />
            </span>
          )}
        </span>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => run('insertUnorderedList')} aria-label={tr('composer.list')} data-tip={tr('composer.list')} className="tip-up">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></svg>
        </button>
        <span className="editor-sep" aria-hidden="true" />
        <button type="button" onClick={() => picker.current?.click()} aria-label={tr('composer.attach')} data-tip={tr('composer.attach')} className="tip-up"><Icon name="clip" size={16} /></button>
        <input ref={picker} type="file" multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); if (f.length) onFiles(f, false); e.target.value = ''; }} />
      </div>
    </div>
  );
});
