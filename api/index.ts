// Vercel serverless entry: the same Express app, wrapped as a request handler.
// The root package.json sets "type": "module" so this entry is emitted as ESM;
// a CommonJS entry cannot load the ESM server workspace (ERR_REQUIRE_ESM), and
// the runtime rewrites dynamic import() back to require(), so static ESM imports
// are the only thing that works here.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../server/src/app.js';
import { connectDatabase } from '../server/src/config/database.js';

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    await connectDatabase();
  } catch (error) {
    // connectDatabase caches the connection and clears its promise on failure, so a
    // later invocation retries. Answer with JSON instead of crashing the function.
    console.error(error);
    response.statusCode = 503;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: 'Database unavailable' }));
    return;
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(request, response);
}
