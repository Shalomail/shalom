// Tema antes do primeiro quadro (sem esperar o app carregar): entrar e cadastro sempre no claro, no azul
// da marca, o resto no que a pessoa escolheu, com o Espectro por cima se estiver ligado. Evita piscar ao
// vir da página inicial.
(function () {
  var auth = /^\/(entrar|criar-conta|confirmar|nova-senha)(\/|$)/.test(location.pathname);
  var saved = null, skin = null;
  try { saved = localStorage.getItem('shalom-theme'); skin = localStorage.getItem('shalom-skin'); } catch (e) { /* sem armazenamento */ }
  var theme = auth || saved === 'light' || saved === 'spectrum' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  if (!auth && (skin === 'spectrum' || saved === 'spectrum')) document.documentElement.setAttribute('data-skin', 'spectrum');
  document.documentElement.style.background = auth ? '#007aff' : theme === 'light' ? '#ffffff' : '#000000';
  if (auth) document.querySelector('meta[name="theme-color"]').setAttribute('content', '#007aff');
})();
