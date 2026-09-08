// Vercel serverless entry: the same Express app, wrapped as a request handler.
import type { IncomingMessage, ServerResponse } from 'node:http';

let ready: Promise<unknown> | null = null;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  // Vercel currently emits this TypeScript entry as CommonJS while the server
  // workspace is ESM. Keep these imports dynamic so Node does not try to load
  // the ESM modules through require().
  const [{ app }, { connectDatabase }] = await Promise.all([
    import('../server/src/app.js'),
    import('../server/src/config/database.js'),
  ]);
  ready ??= connectDatabase();
  await ready;
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(request, response);
}
