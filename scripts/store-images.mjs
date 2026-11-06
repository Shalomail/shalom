// Imagens da App Store: as capturas do app (StoreShots, tema claro) dentro de um iPhone 17 Pro desenhado aqui,
// com título e apoio por cima, e uma última só com o logo. Seis por idioma, PNG sem transparência, em dois tamanhos:
// 1206x2622 (iPhone com Dynamic Island de tela média, o obrigatório na App Store) e 1320x2868 (tela grande).
// Entrada: brand/app-store/capturas/<pt|en>-<tela>-light.png.
// Saída: brand/app-store/<pt-BR|en>/<6.3-1206x2622|6.9-1320x2868>/NN-nome.png (a pasta do idioma é refeita).
// Rodar: node scripts/store-images.mjs [pt en]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('/Users/thomazjr/projects/vsl-pro/package.json');
const puppeteer = require('puppeteer-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'brand/app-store/capturas');
const TMP = join(ROOT, '.tmp/store-images');

const W = 1320, H = 2868;
const BLUE = '#007aff';
// O traço do logo, o mesmo de brand/shalom-mail-logo-branco.svg.
const MARK = 'M0 0H414V306H0Z M28 28V263.5L160.5 159.5L168.5 189L54 278H386V57.5L281.5 244L244.5 188L208 234.5L182 142.5L97 93.5L311 28Z M204.5 122.5L214 150L336 54Z';

const COPY = {
  pt: {
    dir: 'pt-BR',
    images: [
      { file: '01-entrada', shot: '1-inbox', blue: true, logo: true, title: 'E-mail privado\nde verdade.', sub: 'Seus e-mails ficam trancados, e só a sua senha abre.' },
      { file: '02-criptografia', shot: '2-thread', title: 'Criptografia de\npadrão militar.', sub: 'AES-256, a mesma cifra que governos usam para proteger informação ultrassecreta.' },
      { file: '03-escrever', shot: '3-compose', title: 'Trancado antes\nde sair.', sub: 'Entre contas Shalom, só quem recebe consegue abrir.' },
      { file: '04-seguranca', shot: '6-settings', blue: true, title: 'Só você\nentra.', sub: 'Face ID, PIN e verificação em duas etapas.' },
      { file: '05-spam', shot: '4-spam', title: 'Spam longe\nda sua caixa.', sub: 'O que parece golpe vai direto para o Spam.' },
      { file: '06-shalom', blue: true, final: true, foot: 'Sem anúncio, sem rastreio.' },
    ],
  },
  en: {
    dir: 'en',
    clock: '8:41',
    images: [
      { file: '01-inbox', shot: '1-inbox', blue: true, logo: true, title: 'Truly private\nemail.', sub: 'Your emails stay locked, and only your password opens them.' },
      { file: '02-encryption', shot: '2-thread', title: 'Military-grade\nencryption.', sub: 'AES-256, the same cipher governments use to protect top secret information.' },
      { file: '03-compose', shot: '3-compose', title: 'Locked before\nit leaves.', sub: 'Between Shalom accounts, only the recipient can open it.' },
      { file: '04-security', shot: '6-settings', blue: true, title: 'Only you\nget in.', sub: 'Face ID, PIN and two-step verification.' },
      { file: '05-spam', shot: '4-spam', title: 'Spam kept out\nof your inbox.', sub: 'What looks like a scam goes straight to Spam.' },
      { file: '06-shalom', blue: true, final: true, foot: 'No ads, no tracking.' },
    ],
  },
};

// iPhone 17 Pro de frente, em pixels da tela (1206x2622, 460 ppi): borda de alumínio e vidro preto somam
// 36 px de cada lado, cantos da tela com 186 px, Dynamic Island medida numa gravação do simulador.
const SCREEN_W = 1206, SCREEN_H = 2622, EDGE = 36, METAL = 13;
const BODY_W = SCREEN_W + 2 * EDGE, BODY_H = SCREEN_H + 2 * EDGE;
const SCALE = 0.82, PHONE_TOP = 700;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// O simulador escreve a hora da barra no formato de 24 horas ("08:41") e não troca sem reiniciar; em inglês o app
// mostra "8:32 PM", então a hora é redesenhada por cima, no mesmo lugar (texto medido em x 156-284, base em 116).
const pixel = file => [...execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'crop=1:1:60:100', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
const clockOver = (file, time) => `<svg class="clock" viewBox="0 0 ${SCREEN_W} 160"><rect x="130" y="60" width="180" height="76" fill="rgb(${pixel(file)})"/>
  <text x="220" y="116" text-anchor="middle" font-size="53" font-weight="600" fill="#000">${time}</text></svg>`;

const SIZES = [['6.3-1206x2622', 1206, 2622], ['6.9-1320x2868', W, H]];

const BLUE_SHADOW = '0 70px 140px rgba(0, 24, 90, 0.42), 0 20px 44px rgba(0, 24, 90, 0.24)';
const GRAY_SHADOW = '0 70px 140px rgba(20, 28, 45, 0.20), 0 20px 44px rgba(20, 28, 45, 0.12)';

const PAGE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body { font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif; -webkit-font-smoothing: antialiased; position: relative; }
  .phone { position: absolute; width: ${BODY_W}px; height: ${BODY_H}px; transform-origin: 0 0; }
  .key { position: absolute; width: 22px; border-radius: 8px;
    background: linear-gradient(90deg, #9da2a9 0%, #eef0f2 45%, #c2c6cc 100%); }
  .key.l { left: -9px; } .key.r { right: -9px; }
  .key.cam { width: 16px; right: -5px; background: linear-gradient(90deg, #7d828a, #b9bdc3); }
  .body { position: absolute; inset: 0; border-radius: ${186 + EDGE}px;
    background: linear-gradient(140deg, #b4b9c0 0%, #8f959d 45%, #b9bec4 70%, #80868e 100%); }
  .body::before { content: ''; position: absolute; inset: 2px; border-radius: ${186 + EDGE - 2}px;
    background: linear-gradient(140deg, #ffffff 0%, #dfe2e6 40%, #f4f5f7 65%, #c3c7cd 100%); }
  .body::after { content: ''; position: absolute; inset: 6px; border-radius: ${186 + EDGE - 6}px;
    background: linear-gradient(140deg, #e4e7ea 0%, #b8bdc3 42%, #d6d9dd 66%, #a4a9b0 100%); }
  .glass { position: absolute; inset: ${METAL}px; border-radius: ${186 + EDGE - METAL}px; background: #050506;
    box-shadow: inset 0 0 0 1.5px #303034; }
  .screen { position: absolute; left: ${EDGE}px; top: ${EDGE}px; width: ${SCREEN_W}px; height: ${SCREEN_H}px; border-radius: 186px; overflow: hidden; background: #fff; }
  .screen img { display: block; width: ${SCREEN_W}px; height: ${SCREEN_H}px; }
  .clock { position: absolute; left: 0; top: 0; width: ${SCREEN_W}px; height: 160px; font-family: -apple-system, 'SF Pro Text', system-ui; }
  .island { position: absolute; left: 418px; top: 42px; width: 370px; height: 110px; border-radius: 55px; background: #000; }`;

// Um iPhone com a captura, com o canto de cima à esquerda em (x, y) e na escala s.
function phone(lang, shot, x, y, s, shadow) {
  const file = join(SHOTS, `${lang}-${shot}-light.png`);
  readFileSync(file);
  const clock = COPY[lang].clock;
  return `<div class="phone" style="left: ${x}px; top: ${y}px; transform: scale(${s})">
    <div class="key l" style="top: 452px; height: 140px"></div>
    <div class="key l" style="top: 690px; height: 225px"></div>
    <div class="key l" style="top: 955px; height: 225px"></div>
    <div class="key r" style="top: 770px; height: 330px"></div>
    <div class="key cam" style="top: 1610px; height: 210px"></div>
    <div class="body" style="box-shadow: ${shadow}"></div>
    <div class="glass"></div>
    <div class="screen"><img src="${pathToFileURL(file).href}">${clock ? clockOver(file, clock) : ''}<div class="island"></div></div>
  </div>`;
}

const MARK_SVG = width => `<svg viewBox="0 0 414 306" style="width: ${width}px; height: auto; display: block"><path fill="currentColor" fill-rule="evenodd" d="${MARK}"/></svg>`;

// A última: o logo e o essencial em letra pequena, e embaixo três iPhones com o do meio mais alto, na frente.
function finalPage(img, lang) {
  // Os dos lados ficam inteiros na imagem, 16 px da borda, e metade escondida atrás do do meio.
  const mid = 0.58, side = 0.5;
  const midX = (W - BODY_W * mid) / 2, sideW = BODY_W * side;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PAGE_CSS}
  body { background: ${BLUE}; color: #fff; }
  .top { position: absolute; top: 250px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .name { margin-top: 44px; font-size: 92px; font-weight: 700; letter-spacing: -0.035em; }
  .foot { margin-top: 26px; font-size: 38px; line-height: 1.5; color: rgba(255, 255, 255, 0.82); }
  .foot b { display: block; font-weight: 600; color: #fff; }
  </style></head><body>
  <div class="top">${MARK_SVG(210)}<div class="name">Shalom Mail</div><div class="foot">${esc(img.foot)}<b>shalomail.com</b></div></div>
  ${phone(lang, '2-thread', 16, 1190, side, BLUE_SHADOW)}
  ${phone(lang, '3-compose', W - 16 - sideW, 1190, side, BLUE_SHADOW)}
  ${phone(lang, '1-inbox', midX, 990, mid, '0 60px 120px rgba(0, 24, 90, 0.5), 0 24px 50px rgba(0, 24, 90, 0.3)')}
  </body></html>`;
}

function page(img, lang) {
  if (img.final) return finalPage(img, lang);
  const ink = img.blue ? '#ffffff' : '#0a0a0a';
  const soft = img.blue ? 'rgba(255, 255, 255, 0.86)' : '#5b5b62';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PAGE_CSS}
  body { background: ${img.blue ? BLUE : '#f5f5f7'}; }
  /* Título na mesma altura em todas, para a galeria ler como uma série; o logo da primeira fica acima dele. */
  .copy { position: absolute; left: 100px; right: 100px; top: 200px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .brand { position: absolute; top: 84px; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 22px;
    color: ${ink}; font-size: 50px; font-weight: 600; letter-spacing: -0.01em; }
  h1 { color: ${ink}; font-size: 116px; line-height: 1.02; font-weight: 700; letter-spacing: -0.035em; white-space: pre-line; }
  p { color: ${soft}; font-size: 46px; line-height: 1.28; font-weight: 400; letter-spacing: -0.005em; margin-top: 30px; max-width: 980px; text-wrap: balance; }
  </style></head><body>
  ${img.logo ? `<div class="brand">${MARK_SVG(72)}Shalom Mail</div>` : ''}
  <div class="copy">
    <h1>${esc(img.title)}</h1>
    <p>${esc(img.sub)}</p>
  </div>
  ${phone(lang, img.shot, (W - BODY_W * SCALE) / 2, PHONE_TOP, SCALE, img.blue ? BLUE_SHADOW : GRAY_SHADOW)}
  </body></html>`;
}

const langs = process.argv.slice(2).length ? process.argv.slice(2) : ['pt', 'en'];
mkdirSync(TMP, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--allow-file-access-from-files'] });
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  for (const lang of langs) {
    const { dir, images } = COPY[lang];
    const out = join(ROOT, 'brand/app-store', dir);
    rmSync(out, { recursive: true, force: true });
    for (const [size] of SIZES) mkdirSync(join(out, size), { recursive: true });
    for (const img of images) {
      const html = join(TMP, `${lang}-${img.file}.html`);
      writeFileSync(html, page(img, lang));
      await tab.goto(pathToFileURL(html).href, { waitUntil: 'load' });
      await tab.evaluate(() => document.fonts.ready);
      const raw = join(TMP, `${lang}-${img.file}.png`);
      await tab.screenshot({ path: raw, type: 'png' });
      // A App Store recusa imagem com canal de transparência. A tela média tem a mesma proporção (diferença de 0,06%).
      for (const [size, w, h] of SIZES) {
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', `scale=${w}:${h}:flags=lanczos`, '-pix_fmt', 'rgb24', join(out, size, `${img.file}.png`)]);
      }
      console.log(`${dir}/${img.file}.png`);
    }
  }
} finally {
  await browser.close();
  rmSync(TMP, { recursive: true, force: true });
}
