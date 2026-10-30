import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildSite } from '../scripts/site.mjs';
import { pickLocale } from '../shared/locale';

// O site (inicial, termos e privacidade em cada idioma) sai de web/site pelo gerador; o app é o app.html.
// No dev, as rotas do app servem o app.html e a raiz manda para o idioma do navegador; em produção
// quem faz as duas coisas é o Worker.
buildSite();

const APP_ROUTES = /^\/(entrar|criar-conta|caixa|perfil|confirmar|nova-senha|conectar|agentes-ia)(\/|\?|$)/;
const devRoutes = (): Plugin => ({
  name: 'shalom-dev-routes',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url && APP_ROUTES.test(req.url)) req.url = '/app.html';
      else if (req.url === '/' || req.url === '/index.html') {
        const lang = pickLocale(req.headers['accept-language'] ?? null, req.headers.cookie ?? null);
        if (lang !== 'pt') { res.statusCode = 302; res.setHeader('location', `/${lang}/`); res.end(); return; }
      }
      next();
    });
    // Texto ou modelo do site mudou: gera de novo e recarrega.
    server.watcher.add(join(__dirname, 'site'));
    server.watcher.on('change', file => {
      if (!file.startsWith(join(__dirname, 'site'))) return;
      try { buildSite(); server.ws.send({ type: 'full-reload' }); } catch (e) { console.error(e); }
    });
  },
});

// A fonte de cada página começa a baixar junto com o HTML (e não só depois do CSS): sem isso, o texto
// aparece um instante na fonte do sistema e pula quando a certa chega.
const fontPreload = (): Plugin => ({
  name: 'shalom-font-preload',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      if (!ctx.bundle) return html;
      const want = ctx.filename.endsWith('app.html') ? /geist-latin-wght-normal.*\.woff2$/ : /instrument-sans-latin-wght-normal.*\.woff2$/;
      const file = Object.keys(ctx.bundle).find(f => want.test(f));
      if (!file) return html;
      return { html, tags: [{ tag: 'link', attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head-prepend' }] };
    },
  },
});

// Todas as páginas geradas (index.html em qualquer pasta, menos modelos e dependências) mais o app.
function pages(dir: string, out: Record<string, string> = {}) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!['site', 'node_modules', 'public', 'src', 'lp'].includes(name)) pages(full, out);
    } else if (name === 'index.html') {
      out[relative(__dirname, dir) || 'index'] = full;
    }
  }
  return out;
}

// /version.json diz de qual commit saiu o que está no ar, para quem audita compilar o mesmo código e
// comparar (scripts/verify-build.mjs). "-dirty": havia mudança sem commit na hora do build.
const version = (): Plugin => ({
  name: 'shalom-version',
  apply: 'build',
  generateBundle() {
    let commit = 'unknown';
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) commit += '-dirty';
    } catch { /* fora de um repositório git */ }
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ commit }) + '\n' });
  },
});

export default defineConfig({
  root: __dirname,
  appType: 'mpa',
  plugins: [react(), devRoutes(), fontPreload(), version()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: { input: { ...pages(__dirname), app: resolve(__dirname, 'app.html') } },
  },
  server: {
    port: Number(process.env.WEB_PORT) || 4420,
    strictPort: true,
    proxy: { '/api': { target: process.env.WORKER_URL || 'http://127.0.0.1:8790', ws: true } },
  },
});
