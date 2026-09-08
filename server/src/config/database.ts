import mongoose from 'mongoose';

// Serverless invocations reuse the same process, so the connection (and the in-flight
// promise) is cached on globalThis. Without this, every request opens a new pool and
// exhausts the Atlas connection limit.
type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalCache = globalThis as typeof globalThis & { __mongooseCache?: Cache };
const cache: Cache = (globalCache.__mongooseCache ??= { conn: null, promise: null });

export async function connectDatabase() {
  // Values copied from dotenv files can retain their surrounding quotes when
  // they are added through a hosting provider's CLI.
  const uri = process.env.MONGODB_URI
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  if (!uri) throw new Error('MONGODB_URI is required');
  if (cache.conn) return cache.conn;
  cache.promise ??= mongoose.connect(uri, { bufferCommands: false, maxPoolSize: 5, serverSelectionTimeoutMS: 10000 })
    .then(instance => { console.log(`MongoDB connected: ${instance.connection.name}`); return instance; })
    .catch(error => { cache.promise = null; throw error; });
  cache.conn = await cache.promise;
  return cache.conn;
}
