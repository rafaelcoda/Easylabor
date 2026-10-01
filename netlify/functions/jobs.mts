import type { Config } from '@netlify/functions';
// Arquivo gerado no build por `npm run build:functions` (esbuild, tudo empacotado em um único .mjs).
import { runScheduled } from './_generated/jobs.mjs';

export default async () => {
  const summary = await runScheduled();
  console.log('rotinas automáticas', JSON.stringify(summary));
};

export const config: Config = {
  schedule: '*/5 * * * *',
};
