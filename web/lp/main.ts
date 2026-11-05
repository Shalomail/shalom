import './lang';

// Campo de endereço: confere se está livre enquanto a pessoa digita (o mesmo pedido do cadastro)
// e leva o endereço para o cadastro sem pôr nada na URL.
const LOCAL = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;
// Frases do campo no idioma da página (vêm do gerador em <script id="i18n">).
const T = JSON.parse(document.getElementById('i18n')?.textContent || '{}') as Record<string, string>;
const NOTES: Record<string, [string, string]> = {
  checking: [T.checking ?? 'Conferindo...', ''],
  ok: [T.ok ?? 'Está livre.', 'is-ok'],
  taken: [T.taken ?? 'Esse endereço já tem dono.', 'is-warn'],
  reserved: [T.reserved ?? 'Esse endereço é reservado.', 'is-warn'],
  invalid: [T.invalid ?? 'De 3 a 32 letras ou números, começando e terminando com letra ou número.', 'is-warn'],
};
document.querySelectorAll<HTMLFormElement>('.claim').forEach(form => {
  const input = form.querySelector('input')!;
  const grow = form.querySelector<HTMLElement>('.claim-grow')!;
  const note = form.querySelector<HTMLElement>('.claim-note')!;
  const initial = note.innerHTML;
  // O campo do nome cresce com o texto; o resto da caixa ("@shalomail.com" e o vazio) não é o campo.
  // Tocar em qualquer parte dela, menos no botão, leva o cursor para o fim do nome (no celular, só o
  // canto esquerdo funcionava).
  form.querySelector<HTMLElement>('.claim-field')?.addEventListener('pointerdown', e => {
    const target = e.target as Element;
    if (target === input || target.closest('.claim-go')) return;
    e.preventDefault();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  let timer = 0;
  let seq = 0;
  const show = (state: string | null) => {
    note.classList.remove('is-ok', 'is-warn');
    if (!state) { note.innerHTML = initial; return; }
    const [text, cls] = NOTES[state];
    note.textContent = text;
    if (cls) note.classList.add(cls);
  };
  input.addEventListener('input', () => {
    const v = input.value.toLowerCase().replace(/\s|@.*$/g, '');
    if (v !== input.value) input.value = v;
    grow.dataset.value = v;
    clearTimeout(timer);
    const n = ++seq;
    if (v.length < 3) return show(null);
    if (!LOCAL.test(v) || /[._-]{2}/.test(v)) return show('invalid');
    show('checking');
    timer = window.setTimeout(async () => {
      try {
        const r = await fetch('/api/auth/available', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shalom': '1' }, body: JSON.stringify({ address: v }) });
        const j = (await r.json()) as { available: boolean; reason: string | null };
        if (n === seq) show(j.available ? 'ok' : j.reason && NOTES[j.reason] ? j.reason : 'taken');
      } catch { if (n === seq) show(null); }
    }, 350);
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    try { sessionStorage.setItem('shalom-claim', v); } catch { /* sem armazenamento: o cadastro pede de novo */ }
    location.href = '/criar-conta';
  });
});

// Telas do produto empilhando com a rolagem: só com movimento permitido. A página põe em --p quantas
// passagens já aconteceram (0 a 3) e o CSS move cada tela a partir disso.
const deck = document.querySelector<HTMLElement>('.deck');
if (deck && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  deck.classList.add('is-live');
  const stage = deck.querySelector<HTMLElement>('.deck-stage')!;
  const cards = deck.querySelectorAll('.deck-card').length;
  let frame = 0;
  const update = () => {
    frame = 0;
    const step = (deck.offsetHeight - stage.offsetHeight) / (cards - 1);
    const stuck = stage.getBoundingClientRect().top - deck.getBoundingClientRect().top;
    deck.style.setProperty('--p', String(Math.min(Math.max(stuck / step, 0), cards - 1)));
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  update();
}
