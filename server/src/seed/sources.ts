import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { LeadSource } from '../models/index.js';
import { leadSourceNames } from './leadSources.js';

// Adds any missing standard lead sources without touching existing ones or any other data.
async function run() {
  await connectDatabase();
  const result = await LeadSource.bulkWrite(
    leadSourceNames.map((name) => ({
      updateOne: {
        filter: { name },
        update: { $setOnInsert: { name, active: true } },
        upsert: true,
      },
    })),
  );
  console.log(
    `Lead sources: ${result.upsertedCount} added, ${leadSourceNames.length - result.upsertedCount} already present`,
  );
}
run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
