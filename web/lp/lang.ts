// Idioma escolhido no seletor do rodapé fica guardado: a página inicial abre nele da próxima vez.
document.querySelectorAll<HTMLAnchorElement>('[data-lang]').forEach(a => a.addEventListener('click', () => {
  const secure = location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `shalom-lang=${a.dataset.lang}; path=/; max-age=31536000; samesite=lax${secure}`;
}));
