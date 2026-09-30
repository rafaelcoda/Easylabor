import type { Config, Context } from '@netlify/functions';
// Arquivo gerado no build por `npm run build:functions` (esbuild, tudo empacotado em um único .mjs).
import { handle } from './_generated/handler.mjs';

export default async (req: Request, _context: Context) => handle(req);

export const config: Config = {
  path: ['/health', '/v1/*'],
};
