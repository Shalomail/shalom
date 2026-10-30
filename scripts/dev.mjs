// Sobe o Worker (API, porta 8790) e o Vite (app, porta 4420) juntos. Abra http://localhost:4420.
import { spawn } from 'node:child_process';

const run = (name, args) => {
  const p = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}] `;
  p.stdout.on('data', d => process.stdout.write(String(d).replace(/^/gm, tag)));
  p.stderr.on('data', d => process.stderr.write(String(d).replace(/^/gm, tag)));
  p.on('exit', code => { console.log(`${tag}saiu (${code})`); process.exit(code ?? 1); });
  return p;
};

const procs = [
  run('api', ['wrangler', 'dev', '--port', '8790', '--ip', '127.0.0.1']),
  run('app', ['vite', '--config', 'web/vite.config.ts']),
];
const stop = () => { for (const p of procs) p.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
