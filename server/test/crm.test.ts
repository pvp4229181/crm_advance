import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import {
  Role,
  User,
  Lead,
  Opportunity,
  PipelineStage,
  Activity,
  ActivityType,
  Communication,
  AuditLog,
  WebhookJob,
  CustomField,
  ScoringRule,
  SalesTeam,
} from '../src/models/index.js';
import {
  processWebhook,
  drainWebhookJobs,
} from '../src/controllers/whatsapp.controller.js';
import { migrateReliability } from '../src/migrations/reliability.js';

let database: MongoMemoryReplSet;
let server: Server;
let origin: string;
let alice: any, bob: any, admin: any, viewer: any, stage: any, nextStage: any;
const secret = 'integration-test-secret-not-for-production';

before(async () => {
  process.env.JWT_SECRET = secret;
  process.env.NODE_ENV = 'test';
  database = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: {
      version: '8.2.1',
      arch:
        process.platform === 'win32' && process.arch === 'arm64'
          ? 'x64'
          : process.arch,
    },
  });
  await mongoose.connect(database.getUri());
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
  const salesperson = await Role.create({
    name: 'Salesperson',
    permissions: ['own:read', 'own:write'],
  });
  const administrator = await Role.create({
    name: 'Administrator',
    permissions: ['*'],
  });
  const readOnly = await Role.create({
    name: 'Viewer',
    permissions: ['own:read'],
  });
  [alice, bob, admin, viewer] = await User.create([
    {
      name: 'Alice',
      email: 'alice@test.local',
      password: 'unused',
      role: salesperson._id,
    },
    {
      name: 'Bob',
      email: 'bob@test.local',
      password: 'unused',
      role: salesperson._id,
    },
    {
      name: 'Admin',
      email: 'admin@test.local',
      password: 'unused',
      role: administrator._id,
    },
    {
      name: 'Viewer',
      email: 'viewer@test.local',
      password: 'unused',
      role: readOnly._id,
    },
  ]);
  [stage, nextStage] = await PipelineStage.create([
    { name: 'New', sequence: 1, probability: 10 },
    { name: 'Qualified', sequence: 2, probability: 50 },
  ]);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await mongoose.disconnect();
  if (database) await database.stop();
});

async function request(
  user: any,
  path: string,
  method = 'GET',
  body?: unknown,
) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt.sign({ sub: String(user._id) }, secret, { expiresIn: '1h' })}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: response.status === 204 ? undefined : await response.json(),
  };
}
async function lead(owner: any, title: string, extra = {}) {
  return Lead.create({
    title,
    salesperson: owner._id,
    createdBy: owner._id,
    updatedBy: owner._id,
    ...extra,
  });
}
async function opportunity(owner: any, title: string, extra = {}) {
  return Opportunity.create({
    title,
    stage: stage._id,
    salesperson: owner._id,
    createdBy: owner._id,
    updatedBy: owner._id,
    ...extra,
  });
}

test('owner filters cannot expose another salesperson’s leads or opportunities', async () => {
  const otherLead = await lead(bob, 'Private lead');
  const otherDeal = await opportunity(bob, 'Private deal');
  for (const path of ['leads', 'opportunities']) {
    const result = await request(alice, `/${path}?salesperson=${bob._id}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 0);
  }
  assert.equal((await request(alice, `/leads/${otherLead._id}`)).status, 404);
  assert.equal(
    (await request(alice, `/opportunities/${otherDeal._id}`)).status,
    404,
  );
});

test('conversion and every pipeline move ID enforce ownership', async () => {
  const privateLead = await lead(bob, 'Conversion restricted');
  assert.equal(
    (await request(alice, `/leads/${privateLead._id}/convert`, 'POST')).status,
    409,
  );
  assert.equal((await Lead.findById(privateLead._id))?.converted, false);
  const mine = await opportunity(alice, 'My move');
  const other = await opportunity(bob, 'Other move');
  const body = {
    stageId: String(nextStage._id),
    orderedIds: [String(mine._id), String(other._id)],
  };
  assert.equal(
    (await request(alice, `/opportunities/${mine._id}/move`, 'PATCH', body))
      .status,
    403,
  );
  assert.equal(
    String((await Opportunity.findById(mine._id))?.stage),
    String(stage._id),
  );
  assert.equal(
    (
      await request(alice, `/opportunities/${mine._id}/move`, 'PATCH', {
        ...body,
        orderedIds: [String(mine._id)],
      })
    ).status,
    200,
  );
  assert.equal((await Opportunity.findById(mine._id))?.probability, 50);
});

test('conversion is transactional and repeated conversion creates one opportunity', async () => {
  const source = await lead(alice, 'Convert once');
  const results = await Promise.all([
    request(alice, `/leads/${source._id}/convert`, 'POST'),
    request(alice, `/leads/${source._id}/convert`, 'POST'),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
  assert.equal(await Opportunity.countDocuments({ title: source.title }), 1);
});

test('reports group real fields, resolve names, and respect ownership', async () => {
  const result = await request(alice, '/reports?dimension=stage&measure=count');
  const mine = await Opportunity.countDocuments({ salesperson: alice._id });
  assert.equal(result.status, 200);
  assert.equal(
    result.body.reduce((sum: number, row: any) => sum + row.count, 0),
    mine,
  );
  assert(result.body.some((row: any) => row._id === 'New'));
  assert(result.body.some((row: any) => row._id === 'Qualified'));
});

test('PATCH keeps omitted values and imported leads belong to their creator', async () => {
  const source = await lead(alice, 'Keep values', {
    expectedRevenue: 12345,
    priority: 3,
  });
  const result = await request(alice, `/leads/${source._id}`, 'PATCH', {
    title: 'Renamed only',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.expectedRevenue, 12345);
  assert.equal(result.body.priority, 3);
  const imported = await request(alice, '/leads/import', 'POST', {
    rows: [{ Name: 'Imported owned lead' }],
    mapping: { Name: 'title' },
    confirm: true,
  });
  assert.equal(imported.status, 201);
  assert.equal(
    String((await Lead.findOne({ title: 'Imported owned lead' }))?.salesperson),
    String(alice._id),
  );
});

test('read-only custom roles cannot write; users cannot forge ownership or timelines', async () => {
  assert.equal(
    (await request(viewer, '/leads', 'POST', { title: 'Not allowed' })).status,
    403,
  );
  assert.equal(
    (
      await request(alice, '/leads', 'POST', {
        title: 'Wrong owner',
        salesperson: String(bob._id),
      })
    ).status,
    403,
  );
  const privateLead = await lead(bob, 'Private timeline');
  assert.equal(
    (
      await request(alice, `/timeline/Lead/${privateLead._id}`, 'POST', {
        message: 'Injected note',
      })
    ).status,
    404,
  );
  const filter = await request(alice, '/filters', 'POST', {
    name: 'Mine',
    resource: 'leads',
    query: {},
    user: String(bob._id),
  });
  assert.equal(filter.status, 201);
  assert.equal(filter.body.user, String(alice._id));
  const patch = await request(alice, `/filters/${filter.body._id}`, 'PATCH', {
    $set: { user: String(bob._id) },
  });
  assert.equal(patch.status, 422);
});

test('reopening clears closed timestamps and loss metadata', async () => {
  const deal = await opportunity(alice, 'Reopen safely');
  assert.equal(
    (
      await request(alice, `/opportunities/${deal._id}/outcome`, 'PATCH', {
        status: 'lost',
        lostNotes: 'Previous loss',
      })
    ).status,
    200,
  );
  const reopened = await request(
    alice,
    `/opportunities/${deal._id}/outcome`,
    'PATCH',
    { status: 'open' },
  );
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.lostAt, null);
  assert.equal(reopened.body.wonAt, null);
  assert.equal(reopened.body.lostNotes, null);
});

test('expired tokens return 401', async () => {
  const response = await fetch(`${origin}/api/leads`, {
    headers: {
      Authorization: `Bearer ${jwt.sign({ sub: String(alice._id) }, secret, { expiresIn: -1 })}`,
    },
  });
  assert.equal(response.status, 401);
});

test('pipeline summaries include records beyond the first page', async () => {
  await Opportunity.insertMany(
    Array.from({ length: 105 }, (_, index) => ({
      title: `Paged deal ${index}`,
      stage: stage._id,
      salesperson: alice._id,
      expectedRevenue: 10,
      createdBy: alice._id,
      updatedBy: alice._id,
    })),
  );
  const result = await request(
    alice,
    '/opportunities?summary=true&limit=100&sortBy=kanbanOrder&sortOrder=asc',
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 100);
  assert(result.body.pagination.total > 100);
  assert.equal(
    result.body.summary.reduce((sum: number, item: any) => sum + item.count, 0),
    result.body.pagination.total,
  );
  const page2 = await request(
    alice,
    '/opportunities?summary=true&limit=100&sortBy=kanbanOrder&sortOrder=asc&page=2',
  );
  const firstIds = new Set(result.body.data.map((item: any) => item._id));
  assert(page2.body.data.every((item: any) => !firstIds.has(item._id)));
});

test('custom field requirements and types are enforced and scoring is calculated', async () => {
  const field = await request(admin, '/customFields', 'POST', {
    name: 'Budget band',
    key: 'budget_band',
    entity: 'Lead',
    fieldType: 'number',
    required: true,
  });
  assert.equal(field.status, 201);
  assert.equal(
    (await request(alice, '/leads', 'POST', { title: 'Missing field' })).status,
    422,
  );
  assert.equal(
    (
      await request(alice, '/leads', 'POST', {
        title: 'Invalid field',
        customValues: { budget_band: 'bad' },
      })
    ).status,
    422,
  );
  const valid = await request(alice, '/leads', 'POST', {
    title: 'Typed field',
    expectedRevenue: 500,
    customValues: { budget_band: 20 },
  });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.customValues.budget_band, 20);
  assert.equal(
    (
      await request(alice, `/leads/${valid.body._id}`, 'PATCH', {
        title: 'Typed field renamed',
      })
    ).status,
    200,
  );
  const scoring = await request(admin, '/scoringRules', 'POST', {
    name: 'Valuable lead',
    field: 'expectedRevenue',
    operator: 'greater_than',
    value: 400,
    points: 15,
  });
  assert.equal(scoring.status, 201);
  assert.equal(
    (await request(alice, `/leads/${valid.body._id}`)).body.score,
    15,
  );
  await CustomField.findByIdAndUpdate(field.body._id, { active: false });
});

test('concurrent duplicate WhatsApp deliveries create one message', async () => {
  const source = await lead(alice, 'WhatsApp recipient', {
    phone: '+91 98765 43210',
  });
  assert.equal(source.normalizedPhone, '919876543210');
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: 'dedupe-message',
                  from: '919876543210',
                  type: 'text',
                  text: { body: 'Hello' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  await Promise.all([
    processWebhook(payload),
    processWebhook(payload),
    processWebhook(payload),
  ]);
  assert.equal(
    await Communication.countDocuments({ providerMessageId: 'dedupe-message' }),
    1,
  );
  const message = await Communication.findOne({
    providerMessageId: 'dedupe-message',
  });
  assert.equal(String(message?.relatedId), String(source._id));
  assert.equal(message?.metadata.replyState, 'completed');
  await request(alice, `/leads/${source._id}`, 'PATCH', {
    phone: '+91 98765 43211',
  });
  assert.equal(
    (await Lead.findById(source._id))?.normalizedPhone,
    '919876543211',
  );
});

test('failed durable webhook jobs retry without losing their payload', async () => {
  await WebhookJob.create({ _id: 'retry-job', payload: { entry: 42 } });
  await drainWebhookJobs('retry-job');
  let job = await WebhookJob.findById('retry-job');
  assert.equal(job?.status, 'failed');
  assert.equal(job?.attempts, 1);
  assert.equal(job?.payload.entry, 42);
  await WebhookJob.updateOne(
    { _id: 'retry-job' },
    { $set: { payload: { entry: [] }, nextAttemptAt: new Date(0) } },
  );
  assert.equal(await drainWebhookJobs('retry-job'), 1);
  job = await WebhookJob.findById('retry-job');
  assert.equal(job?.status, 'completed');
  assert.equal(job?.attempts, 2);
});

test('audit records capture changes and cannot be forged or deleted', async () => {
  const record = await request(alice, '/leads', 'POST', {
    title: 'Audited creation',
  });
  assert.equal(record.status, 201);
  const audit = await AuditLog.findOne({
    entityId: record.body._id,
    action: 'created',
  });
  assert(audit);
  assert.equal(String(audit.actor), String(alice._id));
  assert.equal(
    (await request(admin, '/auditLogs', 'POST', { action: 'fake' })).status,
    405,
  );
  assert.equal(
    (await request(admin, `/auditLogs/${audit._id}`, 'DELETE')).status,
    405,
  );
});

test('migration repairs legacy phone indexes and ownerless records and is rerunnable', async () => {
  const record = await lead(alice, 'Legacy lead', { phone: '+91 99887 76655' });
  await Lead.collection.updateOne(
    { _id: record._id },
    { $unset: { normalizedPhone: 1, phoneSuffix: 1, salesperson: 1 } },
  );
  const result = await migrateReliability();
  assert(result.normalizedPhones >= 1);
  const repaired = await Lead.findById(record._id);
  assert.equal(repaired?.normalizedPhone, '919988776655');
  assert.equal(String(repaired?.salesperson), String(alice._id));
  const again = await migrateReliability();
  assert.equal(again.normalizedPhones, 0);
  assert.equal(again.assignedLeads, 0);
});

test('managers can access their teams but cannot administer outsiders', async () => {
  const role = await Role.create({
    name: 'Sales Manager',
    permissions: ['team:read', 'team:write', 'reports:read'],
  });
  const manager = await User.create({
    name: 'Manager',
    email: 'manager@test.local',
    password: 'unused',
    role: role._id,
  });
  const team = await SalesTeam.create({
    name: 'Team A',
    teamLeader: manager._id,
    members: [alice._id],
  });
  const record = await lead(alice, 'Team record', { salesTeam: team._id });
  assert.equal((await request(manager, `/leads/${record._id}`)).status, 200);
  const people = await request(manager, '/admin/users');
  assert.equal(people.status, 200);
  assert(people.body.some((person: any) => person._id === String(alice._id)));
  assert(!people.body.some((person: any) => person._id === String(bob._id)));
  assert.equal(
    (
      await request(manager, `/admin/users/${bob._id}`, 'PATCH', {
        active: false,
      })
    ).status,
    403,
  );
});

test('signed webhooks are durably recorded before acknowledgement', async () => {
  process.env.WHATSAPP_APP_SECRET = 'test-webhook-secret';
  const raw = JSON.stringify({ entry: [] });
  const signature = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
  const id = crypto.createHash('sha256').update(raw).digest('hex');
  const response = await fetch(`${origin}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': signature,
    },
    body: raw,
  });
  assert.equal(response.status, 200);
  assert(await WebhookJob.findById(id));
  const invalid = await fetch(`${origin}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });
  assert.equal(invalid.status, 401);
  await drainWebhookJobs(id);
  assert.equal(await WebhookJob.countDocuments({ _id: id }), 1);
});

test('field and scoring configuration reject unusable definitions', async () => {
  assert.equal(
    (
      await request(admin, '/customFields', 'POST', {
        name: 'Empty choices',
        key: 'empty_choices',
        entity: 'Lead',
        fieldType: 'dropdown',
        options: [],
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(admin, '/scoringRules', 'POST', {
        name: 'Bad threshold',
        field: 'expectedRevenue',
        operator: 'greater_than',
        value: 'not a number',
        points: 10,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(alice, '/leads/import', 'POST', {
        rows: [{ Name: 'Invalid confirmation' }],
        mapping: { Name: 'title' },
        confirm: 'false',
      })
    ).status,
    422,
  );
});

test('import keeps a corrected contact after an invalid row and skips later duplicates', async () => {
  const email = 'corrected-import@test.local';
  const result = await request(alice, '/leads/import', 'POST', {
    mapping: { title: 'title', email: 'email', value: 'expectedRevenue' },
    rows: [
      { title: 'Invalid value', email, value: '-5' },
      {
        title: 'Corrected contact',
        email: email.toUpperCase(),
        value: '12500',
      },
      { title: 'Repeated contact', email, value: '12500' },
    ],
    confirm: true,
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.imported, 1);
  assert.equal(result.body.invalid, 1);
  assert.equal(result.body.duplicates, 1);
  const saved = await Lead.findOne({ email });
  assert.equal(saved?.title, 'Corrected contact');
  assert.equal(saved?.expectedRevenue, 12500);
  const empty = await request(alice, '/leads/import', 'POST', {
    mapping: { title: 'title' },
    rows: [],
  });
  assert.equal(empty.status, 422);
});
