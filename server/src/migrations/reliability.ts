import mongoose from 'mongoose';
import { Communication, Lead, Opportunity, User } from '../models/index.js';
import { normalizePhone, phoneSuffix } from '../utils/phone.js';

// Rerunnable migration. Duplicate messages are reported for review, never silently deleted.
export async function migrateReliability() {
  const duplicates = await Communication.aggregate([
    {
      $match: {
        provider: { $type: 'string' },
        providerMessageId: { $type: 'string' },
      },
    },
    {
      $group: {
        _id: { provider: '$provider', message: '$providerMessageId' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 },
  ]);
  if (duplicates.length)
    throw new Error(
      `Resolve duplicate provider message IDs before migrating: ${JSON.stringify(duplicates)}`,
    );
  const activeUsers = await User.find({ active: true }).distinct('_id');
  let phones = 0,
    owners = 0;
  let writes: any[] = [];
  for await (const lead of Lead.find({})
    .select('phone normalizedPhone phoneSuffix salesperson createdBy')
    .lean()
    .cursor()) {
    const update: Record<string, unknown> = {};
    const normalized = normalizePhone(lead.phone);
    if (
      lead.normalizedPhone !== normalized ||
      lead.phoneSuffix !== phoneSuffix(lead.phone)
    ) {
      update.normalizedPhone = normalized;
      update.phoneSuffix = phoneSuffix(lead.phone);
      phones++;
    }
    if (
      !lead.salesperson &&
      activeUsers.some((id) => String(id) === String(lead.createdBy))
    ) {
      update.salesperson = lead.createdBy;
      owners++;
    }
    if (Object.keys(update).length)
      writes.push({
        updateOne: { filter: { _id: lead._id }, update: { $set: update } },
      });
    if (writes.length >= 500) {
      await Lead.bulkWrite(writes);
      writes = [];
    }
  }
  if (writes.length) await Lead.bulkWrite(writes);
  for (const actor of activeUsers)
    await Opportunity.updateMany(
      { salesperson: null, createdBy: actor },
      { $set: { salesperson: actor } },
    );
  // New installations use schema indexes; existing installations need the new unique index explicitly.
  await Communication.collection.createIndex(
    { provider: 1, providerMessageId: 1 },
    {
      name: 'provider_message_unique',
      unique: true,
      partialFilterExpression: {
        provider: { $type: 'string' },
        providerMessageId: { $type: 'string' },
      },
    },
  );
  for (const model of Object.values(mongoose.models))
    await model.createIndexes();
  return { normalizedPhones: phones, assignedLeads: owners };
}
