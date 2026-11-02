// Tema deste aparelho: base escura (padrão) ou clara, e o Espectro por cima de qualquer uma das duas
// (a barra lateral em arco-íris). As telas de entrar e de cadastro ficam sempre no claro.
import { useEffect } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'shalom-theme';
const SKIN = 'shalom-skin';

// "spectrum" em shalom-theme é de antes do Espectro virar interruptor: vale como claro + Espectro.
export function currentTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'spectrum' ? 'light' : 'dark';
}

export function spectrumOn(): boolean {
  return localStorage.getItem(SKIN) === 'spectrum' || localStorage.getItem(KEY) === 'spectrum';
}

export function applyTheme(theme: Theme = currentTheme(), spectrum = spectrumOn()) {
  const html = document.documentElement;
  html.dataset.theme = theme;
  if (spectrum) html.dataset.skin = 'spectrum';
  else delete html.dataset.skin;
  html.style.background = '';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
}

function save(theme: Theme, spectrum: boolean) {
  localStorage.setItem(KEY, theme);
  localStorage.setItem(SKIN, spectrum ? 'spectrum' : '');
  applyTheme(theme, spectrum);
  window.dispatchEvent(new Event('shalom:theme'));
}

export const setTheme = (theme: Theme) => save(theme, spectrumOn());
export const setSpectrum = (on: boolean) => save(currentTheme(), on);

// Telas de entrar, cadastro e recuperação: claro (fundo branco) enquanto estão abertas, sem Espectro; ao sair, volta
// o tema da pessoa.
export function useAuthTheme() {
  useEffect(() => {
    applyTheme('light', false);
    return () => applyTheme();
  }, []);
}
