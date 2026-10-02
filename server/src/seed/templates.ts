import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { WhatsAppBot, WhatsAppTemplate } from '../models/index.js';
import {
  crmTemplateProblem,
  templateProblem,
} from '../services/whatsapp.service.js';
import { crmTemplates, metaTemplates } from './whatsappTemplates.js';

// Adds any missing WhatsApp templates without touching existing ones. Meta templates are saved as drafts and are not
// sent to Meta here: the CRM's "Sync with Meta" submits them, so a blocked or missing Meta account never breaks seeding.
async function run() {
  const problems = [
    ...metaTemplates('').map((t) => [
      t.name,
      templateProblem(t.body, t.variables),
    ]),
    ...crmTemplates.map((t) => [t.name, crmTemplateProblem(t.body)]),
  ].filter(([, problem]) => problem);
  if (problems.length)
    throw new Error(
      `Invalid templates: ${problems.map(([name, problem]) => `${name}: ${problem}`).join('; ')}`,
    );
  await connectDatabase();
  const bot: any = await WhatsAppBot.findOne({ key: 'default' }).lean();
  const meta = await WhatsAppTemplate.bulkWrite(
    metaTemplates(bot?.businessName ?? '').map((t) => ({
      updateOne: {
        filter: { name: t.name, language: t.language },
        update: {
          $setOnInsert: {
            ...t,
            kind: 'meta' as const,
            status: 'DRAFT',
            active: true,
          },
        },
        upsert: true,
      },
    })),
  );
  const crm = await WhatsAppTemplate.bulkWrite(
    crmTemplates.map((t) => ({
      updateOne: {
        filter: { name: t.name, language: 'crm' },
        update: {
          $setOnInsert: {
            ...t,
            kind: 'crm' as const,
            language: 'crm',
            status: 'READY',
            variables: [] as string[],
            active: true,
          },
        },
        upsert: true,
      },
    })),
  );
  console.log(
    `CRM templates: ${crm.upsertedCount} added, ${crmTemplates.length - crm.upsertedCount} already present`,
  );
  console.log(
    `WhatsApp approved templates: ${meta.upsertedCount} added as drafts, ${metaTemplates('').length - meta.upsertedCount} already present. Use "Sync with Meta" in the CRM to submit drafts for approval.`,
  );
}
run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
