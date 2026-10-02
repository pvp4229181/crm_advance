import 'dotenv/config';
import mongoose from 'mongoose';
import { migrateReliability } from './reliability.js';

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  // Preflight duplicates before allowing automatic index creation.
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  try {
    console.log(await migrateReliability());
  } finally {
    await mongoose.disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
