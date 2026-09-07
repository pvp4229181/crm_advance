// Vercel serverless entry: the same Express app, wrapped as a request handler.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../server/src/app.js';
import { connectDatabase } from '../server/src/config/database.js';

let ready: Promise<unknown> | null = null;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  ready ??= connectDatabase();
  await ready;
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(request, response);
}
