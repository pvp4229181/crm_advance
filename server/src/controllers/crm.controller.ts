import {
  validateCustomValues,
  scoredLeads,
} from '../services/fields.service.js';
import { recordAudit } from '../services/audit.service.js';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  Activity,
  ActivityType,
  AuditLog,
  Campaign,
  Communication,
  Company,
  Contact,
  CustomField,
  EmailTemplate,
  Lead,
  LeadSource,
  LostReason,
  Medium,
  Notification,
  Opportunity,
  PipelineStage,
  SalesTeam,
  SavedFilter,
  ScoringRule,
  Tag,
  TimelineEvent,
  User,
  WhatsAppTemplate,
  Workflow,
} from '../models/index.js';
import { accessScope, scopedFilter } from '../middleware/auth.js';
import {
  leadInput,
  listQuery,
  opportunityInput,
  parsePatch,
} from '../validators/index.js';
import { ApiError, escapeRegex } from '../utils/http.js';
import { convertLead, moveOpportunity } from '../services/crm.service.js';
import {
  validateAssignment,
  validateReferences,
} from '../services/access.service.js';
import { runWorkflows } from '../services/workflow.service.js';

const pop = [
  { path: 'salesperson', select: 'name email avatar' },
  { path: 'salesTeam', select: 'name' },
  { path: 'stage', select: 'name color sequence probability' },
  { path: 'company', select: 'name' },
  { path: 'contact', select: 'name' },
  { path: 'tags', select: 'name color' },
  { path: 'source', select: 'name' },
  { path: 'campaign', select: 'name' },
];
const leadPop = [
  { path: 'salesperson', select: 'name email avatar' },
  { path: 'salesTeam', select: 'name' },
  { path: 'tags', select: 'name color' },
  { path: 'source', select: 'name' },
  { path: 'medium', select: 'name' },
  { path: 'campaign', select: 'name' },
  {
    path: 'convertedOpportunity',
    select: 'stage',
    populate: { path: 'stage', select: 'name color sequence' },
  },
];
export async function listOpportunities(req: Request, res: Response) {
  const q = listQuery.parse(req.query);
  const filter: any = {};
  for (const key of [
    'status',
    'stage',
    'salesperson',
    'source',
    'campaign',
    'company',
    'contact',
  ] as const)
    if (q[key]) filter[key] = q[key];
  if (q.team) filter.salesTeam = q.team;
  if (q.priority !== undefined) filter.priority = q.priority;
  if (q.search)
    filter.$or = ['title', 'email', 'phone'].map((key) => ({
      [key]: new RegExp(escapeRegex(q.search!), 'i'),
    }));
  const skip = (q.page - 1) * q.limit;
  const [data, total, summary] = await Promise.all([
    Opportunity.find(scopedFilter(req, filter))
      .populate(pop)
      .sort({ [q.sortBy]: q.sortOrder === 'asc' ? 1 : -1, _id: 1 })
      .skip(skip)
      .limit(q.limit),
    Opportunity.countDocuments(scopedFilter(req, filter)),
    q.summary
      ? Opportunity.aggregate([
          { $match: scopedFilter(req, filter) },
          {
            $group: {
              _id: `$${q.groupBy === 'team' ? 'salesTeam' : q.groupBy || 'stage'}`,
              count: { $sum: 1 },
              value: { $sum: '$expectedRevenue' },
            },
          },
        ])
      : Promise.resolve(undefined),
  ]);
  res.json({
    data,
    summary,
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      pages: Math.ceil(total / q.limit),
    },
  });
}
export async function createOpportunity(req: Request, res: Response) {
  const input = await validateAssignment(
    req,
    opportunityInput.parse(req.body),
    true,
  );
  await validateCustomValues('Opportunity', input);
  await validateReferences(req, input);
  const stage: any = await PipelineStage.findOne({
    _id: input.stage,
    active: true,
  });
  if (!stage) throw new ApiError(422, 'Choose an active pipeline stage');
  input.probability = stage.probability;
  if (stage.isWon) {
    input.status = 'won';
    input.wonAt = new Date();
  }
  const count = await Opportunity.countDocuments({ stage: input.stage });
  const doc = await Opportunity.create({
    ...input,
    kanbanOrder: count,
    createdBy: req.user!._id,
    updatedBy: req.user!._id,
  });
  await TimelineEvent.create({
    createdBy: req.user!._id,
    relatedModel: 'Opportunity',
    relatedId: doc._id,
    eventType: 'opportunity_created',
    message: 'Opportunity created',
  });
  await recordAudit(req, 'created', 'Opportunity', doc._id);
  if (doc.status === 'won')
    await runWorkflows('opportunity_won', [doc.toObject()], req.user!._id);
  res.status(201).json(await doc.populate(pop));
}
export async function getOpportunity(req: Request, res: Response) {
  const doc = await Opportunity.findOne({
    _id: req.params.id,
    ...accessScope(req),
  }).populate(pop);
  if (!doc) throw new ApiError(404, 'Opportunity not found');
  const [timeline, activities] = await Promise.all([
    TimelineEvent.find({ relatedModel: 'Opportunity', relatedId: doc._id })
      .populate('createdBy', 'name avatar')
      .sort('-createdAt'),
    Activity.find({ relatedModel: 'Opportunity', relatedId: doc._id })
      .populate('assignedTo activityType')
      .sort('dueDate'),
  ]);
  res.json({ ...doc.toObject(), timeline, activities });
}
export async function updateOpportunity(req: Request, res: Response) {
  const input = await validateAssignment(
    req,
    parsePatch(opportunityInput, req.body),
  );
  const current = await Opportunity.findOne({
    _id: req.params.id,
    ...accessScope(req),
  }).lean();
  if (!current) throw new ApiError(404, 'Opportunity not found');
  await validateCustomValues('Opportunity', input, current);
  await validateReferences(req, input);
  if (input.stage && String(input.stage) !== String(current.stage))
    throw new ApiError(422, 'Use the pipeline move action to change stages');
  const doc = await Opportunity.findOneAndUpdate(
    { _id: req.params.id, ...accessScope(req) },
    { ...input, updatedBy: req.user!._id },
    { new: true, runValidators: true },
  ).populate(pop);
  if (!doc) throw new ApiError(404, 'Opportunity not found');
  await recordAudit(req, 'updated', 'Opportunity', doc._id, input);
  res.json(doc);
}
export async function setOutcome(req: Request, res: Response) {
  const status = req.body.status as string;
  if (!['won', 'lost', 'open'].includes(status))
    throw new ApiError(422, 'Invalid status');
  const update: any = {
    status,
    updatedBy: req.user!._id,
    wonAt: status === 'won' ? new Date() : null,
    lostAt: status === 'lost' ? new Date() : null,
    lostReason: status === 'lost' ? req.body.lostReason || null : null,
    lostNotes:
      status === 'lost'
        ? String(req.body.lostNotes ?? '').slice(0, 2000)
        : null,
  };
  const previous = await Opportunity.findOne({
    _id: req.params.id,
    ...accessScope(req),
  })
    .select('status')
    .lean();
  let doc = await Opportunity.findOneAndUpdate(
    { _id: req.params.id, ...accessScope(req) },
    update,
    { new: true, runValidators: true },
  ).populate(pop);
  if (!doc) throw new ApiError(404, 'Opportunity not found');
  await TimelineEvent.create({
    createdBy: req.user!._id,
    relatedModel: 'Opportunity',
    relatedId: doc._id,
    eventType: `opportunity_${status === 'open' ? 'reopened' : status}`,
    message:
      status === 'open'
        ? 'Opportunity reopened'
        : `Opportunity marked ${status}`,
  });
  if (
    status !== 'open' &&
    previous?.status !== status &&
    (await runWorkflows(
      status === 'won' ? 'opportunity_won' : 'opportunity_lost',
      [doc.toObject()],
      req.user!._id,
    ))
  )
    doc = (await Opportunity.findById(doc._id).populate(pop)) ?? doc;
  await recordAudit(
    req,
    status === 'open' ? 'reopened' : status,
    'Opportunity',
    doc._id,
  );
  res.json(doc);
}
export async function move(req: Request, res: Response) {
  const body = req.body as { stageId: string; orderedIds: string[] };
  if (
    !mongoose.isValidObjectId(req.params.id) ||
    !mongoose.isValidObjectId(body.stageId) ||
    !Array.isArray(body.orderedIds) ||
    body.orderedIds.length > 10000 ||
    !body.orderedIds.includes(String(req.params.id)) ||
    new Set(body.orderedIds).size !== body.orderedIds.length ||
    body.orderedIds.some((x) => !mongoose.isValidObjectId(x))
  )
    throw new ApiError(422, 'Invalid move');
  const changed = await moveOpportunity(
    String(req.params.id),
    body.stageId,
    body.orderedIds,
    req.user!._id,
    accessScope(req),
  );
  if (changed) {
    const opportunity = await Opportunity.findById(req.params.id).lean();
    if (opportunity) {
      await runWorkflows(
        'opportunity_stage_changed',
        [opportunity],
        req.user!._id,
      );
      if (opportunity.status === 'won')
        await runWorkflows('opportunity_won', [opportunity], req.user!._id);
    }
  }
  res.json({ success: true });
}

export async function deleteOpportunity(req: Request, res: Response) {
  const doc = await Opportunity.findOneAndDelete({
    _id: req.params.id,
    ...accessScope(req),
  });
  if (!doc) throw new ApiError(404, 'Opportunity not found');
  await Promise.all([
    TimelineEvent.deleteMany({
      relatedModel: 'Opportunity',
      relatedId: doc._id,
    }),
    Activity.deleteMany({ relatedModel: 'Opportunity', relatedId: doc._id }),
    Lead.updateMany(
      { convertedOpportunity: doc._id },
      { $unset: { convertedOpportunity: 1 } },
    ),
  ]);
  await recordAudit(req, 'deleted', 'Opportunity', doc._id);
  res.status(204).end();
}

export async function listLeads(req: Request, res: Response) {
  const q = listQuery.parse(req.query);
  const filter: any = {};
  for (const key of ['status', 'salesperson', 'source', 'campaign'] as const)
    if (q[key]) filter[key] = q[key];
  if (q.team) filter.salesTeam = q.team;
  if (q.priority !== undefined) filter.priority = q.priority;
  if (q.search)
    filter.$or = ['title', 'contactName', 'companyName', 'email', 'phone'].map(
      (k) => ({ [k]: new RegExp(escapeRegex(q.search!), 'i') }),
    );
  const [data, total] = await Promise.all([
    Lead.find(scopedFilter(req, filter))
      .populate(leadPop)
      .sort({ [q.sortBy]: q.sortOrder === 'asc' ? 1 : -1, _id: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    Lead.countDocuments(scopedFilter(req, filter)),
  ]);
  res.json({
    data: await scoredLeads(data),
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      pages: Math.ceil(total / q.limit),
    },
  });
}
export async function getLead(req: Request, res: Response) {
  const doc = await Lead.findOne({
    _id: req.params.id,
    ...accessScope(req),
  }).populate(leadPop);
  if (!doc) throw new ApiError(404, 'Lead not found');
  const [timeline, activities] = await Promise.all([
    TimelineEvent.find({ relatedModel: 'Lead', relatedId: doc._id })
      .populate('createdBy', 'name avatar')
      .sort('-createdAt'),
    Activity.find({ relatedModel: 'Lead', relatedId: doc._id })
      .populate('assignedTo', 'name avatar')
      .populate('activityType', 'name icon')
      .sort('dueDate'),
  ]);
  res.json({ ...(await scoredLeads([doc]))[0], timeline, activities });
}
export async function createLead(req: Request, res: Response) {
  const input = await validateAssignment(req, leadInput.parse(req.body), true);
  await validateCustomValues('Lead', input);
  const doc = await Lead.create({
    ...input,
    createdBy: req.user!._id,
    updatedBy: req.user!._id,
  });
  const ran = await runWorkflows(
    'lead_created',
    [doc.toObject()],
    req.user!._id,
  );
  await recordAudit(req, 'created', 'Lead', doc._id);
  res.status(201).json(ran ? await Lead.findById(doc._id) : doc);
}
export async function updateLead(req: Request, res: Response) {
  const input = await validateAssignment(req, parsePatch(leadInput, req.body));
  const existing = await Lead.findOne({
    _id: req.params.id,
    ...accessScope(req),
  }).lean();
  if (!existing) throw new ApiError(404, 'Lead not found');
  await validateCustomValues('Lead', input, existing);
  let previousStatus: string | undefined;
  if (input.status) {
    const current = await Lead.findOne({
      _id: req.params.id,
      ...accessScope(req),
    }).select('converted status');
    if (current?.converted)
      throw new ApiError(409, 'A converted lead cannot change status');
    previousStatus = current?.status;
  }
  let doc = await Lead.findOneAndUpdate(
    { _id: req.params.id, ...accessScope(req) },
    { ...input, updatedBy: req.user!._id },
    { new: true, runValidators: true },
  );
  if (!doc) throw new ApiError(404, 'Lead not found');
  if (
    previousStatus &&
    previousStatus !== doc.status &&
    (await runWorkflows('lead_status_changed', [doc.toObject()], req.user!._id))
  )
    doc = (await Lead.findById(doc._id)) ?? doc;
  await recordAudit(req, 'updated', 'Lead', doc._id, input);
  res.json(doc);
}
export async function deleteLead(req: Request, res: Response) {
  const doc = await Lead.findOneAndDelete({
    _id: req.params.id,
    ...accessScope(req),
  });
  if (!doc) throw new ApiError(404, 'Lead not found');
  await Promise.all([
    TimelineEvent.deleteMany({ relatedModel: 'Lead', relatedId: doc._id }),
    Activity.deleteMany({ relatedModel: 'Lead', relatedId: doc._id }),
    Communication.deleteMany({ relatedModel: 'Lead', relatedId: doc._id }),
  ]);
  await recordAudit(req, 'deleted', 'Lead', doc._id);
  res.status(204).end();
}
export async function convert(req: Request, res: Response) {
  res
    .status(201)
    .json(
      await convertLead(String(req.params.id), req.user!._id, accessScope(req)),
    );
}
export async function bulkLeads(req: Request, res: Response) {
  const ids = Array.isArray(req.body.ids)
    ? [...new Set(req.body.ids.map(String))]
    : [];
  const action = String(req.body.action ?? '');
  const value = req.body.value;
  if (
    !ids.length ||
    ids.length > 200 ||
    ids.some((id) => !mongoose.isValidObjectId(id))
  )
    throw new ApiError(422, 'Select between 1 and 200 valid leads');
  const allowed = [
    'status',
    'salesperson',
    'salesTeam',
    'priority',
    'source',
    'addTag',
    'removeTag',
    'convert',
    'delete',
  ];
  if (!allowed.includes(action))
    throw new ApiError(422, 'Unsupported bulk action');
  if (action === 'salesperson' || action === 'salesTeam')
    await validateAssignment(req, { [action]: value || null });
  const scope: any = { _id: { $in: ids }, ...accessScope(req) };
  const accessible = await Lead.find(scope)
    .select('_id converted title status')
    .lean();
  if (!accessible.length)
    throw new ApiError(404, 'No accessible leads were selected');
  const accessibleIds = accessible.map((x) => x._id);
  if (action === 'delete') {
    await AuditLog.insertMany(
      accessible.map((lead) => ({
        actor: req.user!._id,
        action: 'deleted',
        entityType: 'Lead',
        entityId: lead._id,
      })),
    );
    const result = await Lead.deleteMany({ _id: { $in: accessibleIds } });
    await Promise.all([
      TimelineEvent.deleteMany({
        relatedModel: 'Lead',
        relatedId: { $in: accessibleIds },
      }),
      Activity.deleteMany({
        relatedModel: 'Lead',
        relatedId: { $in: accessibleIds },
      }),
    ]);
    return res.json({
      matched: accessible.length,
      modified: result.deletedCount,
      message: `Deleted ${result.deletedCount} leads`,
    });
  }
  if (action === 'convert') {
    let modified = 0;
    const errors: { id: string; message: string }[] = [];
    for (const lead of accessible) {
      if (lead.converted) {
        errors.push({ id: String(lead._id), message: 'Already converted' });
        continue;
      }
      try {
        await convertLead(String(lead._id), req.user!._id, accessScope(req));
        modified++;
      } catch (error) {
        errors.push({
          id: String(lead._id),
          message: error instanceof Error ? error.message : 'Conversion failed',
        });
      }
    }
    return res.json({
      matched: accessible.length,
      modified,
      errors,
      message: `Converted ${modified} leads`,
    });
  }
  let update: any,
    message = 'Leads updated';
  if (action === 'status') {
    if (!['new', 'qualified', 'disqualified'].includes(String(value)))
      throw new ApiError(422, 'Invalid lead status');
    update = { $set: { status: value, updatedBy: req.user!._id } };
    scope.converted = { $ne: true };
    message = `Status changed to ${value}`;
  } else if (action === 'priority') {
    const priority = Number(value);
    if (!Number.isInteger(priority) || priority < 0 || priority > 3)
      throw new ApiError(422, 'Priority must be between 0 and 3');
    update = { $set: { priority, updatedBy: req.user!._id } };
    message = 'Priority updated';
  } else if (['salesperson', 'salesTeam', 'source'].includes(action)) {
    if (value !== null && value !== '' && !mongoose.isValidObjectId(value))
      throw new ApiError(422, 'Invalid selection');
    update = { $set: { [action]: value || null, updatedBy: req.user!._id } };
    message = `${action} updated`;
  } else {
    if (!mongoose.isValidObjectId(value))
      throw new ApiError(422, 'Invalid tag');
    update =
      action === 'addTag'
        ? { $addToSet: { tags: value }, $set: { updatedBy: req.user!._id } }
        : { $pull: { tags: value }, $set: { updatedBy: req.user!._id } };
    message = action === 'addTag' ? 'Tag added' : 'Tag removed';
  }
  const result = await Lead.updateMany(scope, update, { runValidators: true });
  if (result.modifiedCount)
    await AuditLog.insertMany(
      accessible.map((lead) => ({
        actor: req.user!._id,
        action: 'bulk_updated',
        entityType: 'Lead',
        entityId: lead._id,
        changes: { action, value },
      })),
    );
  if (result.modifiedCount)
    await TimelineEvent.insertMany(
      accessibleIds.map((id) => ({
        createdBy: req.user!._id,
        relatedModel: 'Lead',
        relatedId: id,
        eventType: 'bulk_updated',
        message,
      })),
    );
  if (action === 'status') {
    const changed = accessible
      .filter((lead) => !lead.converted && lead.status !== value)
      .map((lead) => lead._id);
    if (changed.length)
      await runWorkflows(
        'lead_status_changed',
        await Lead.find({ _id: { $in: changed } }).lean(),
        req.user!._id,
      );
  }
  res.json({
    matched: result.matchedCount,
    modified: result.modifiedCount,
    message,
  });
}

export async function dashboard(req: Request, res: Response) {
  const now = new Date(),
    today = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    tomorrow = new Date(today),
    monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  tomorrow.setDate(today.getDate() + 1);
  const scope = accessScope(req),
    activityScope =
      (req.user!.role as any).name === 'Administrator'
        ? {}
        : { assignedTo: req.user!._id };
  const [
    summary,
    pipeline,
    monthly,
    activities,
    totalLeads,
    newLeads,
    recentLeads,
    sources,
    attention,
    leadTrend,
    pipelineDeals,
  ] = await Promise.all([
    Opportunity.aggregate([
      { $match: scope },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pipelineValue: {
            $sum: {
              $cond: [{ $eq: ['$status', 'open'] }, '$expectedRevenue', 0],
            },
          },
          wonRevenue: {
            $sum: {
              $cond: [{ $eq: ['$status', 'won'] }, '$expectedRevenue', 0],
            },
          },
          won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
        },
      },
    ]),
    Opportunity.aggregate([
      { $match: { ...scope, status: 'open' } },
      {
        $lookup: {
          from: 'pipelinestages',
          localField: 'stage',
          foreignField: '_id',
          as: 'stage',
        },
      },
      { $unwind: '$stage' },
      {
        $group: {
          _id: '$stage.name',
          value: { $sum: '$expectedRevenue' },
          count: { $sum: 1 },
          sequence: { $first: '$stage.sequence' },
          color: { $first: '$stage.color' },
        },
      },
      { $sort: { sequence: 1 } },
    ]),
    Opportunity.aggregate([
      { $match: { ...scope, status: 'won', wonAt: { $ne: null } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$wonAt' } },
          value: { $sum: '$expectedRevenue' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 12 },
      { $sort: { _id: 1 } },
    ]),
    Activity.aggregate([
      { $match: { ...activityScope, status: 'planned' } },
      {
        $facet: {
          today: [
            { $match: { dueDate: { $gte: today, $lt: tomorrow } } },
            { $count: 'count' },
          ],
          overdue: [
            { $match: { dueDate: { $lt: today } } },
            { $count: 'count' },
          ],
        },
      },
    ]),
    Lead.countDocuments(scope),
    Lead.countDocuments({ ...scope, createdAt: { $gte: monthStart } }),
    Lead.find(scope)
      .populate('salesperson', 'name avatar')
      .populate('source', 'name')
      .sort('-createdAt')
      .limit(6)
      .lean(),
    Lead.aggregate([
      { $match: scope },
      {
        $lookup: {
          from: 'leadsources',
          localField: 'source',
          foreignField: '_id',
          as: 'source',
        },
      },
      {
        $group: {
          _id: { $ifNull: [{ $first: '$source.name' }, 'Other'] },
          leads: { $sum: 1 },
          qualified: {
            $sum: {
              $cond: [{ $in: ['$status', ['qualified', 'converted']] }, 1, 0],
            },
          },
          converted: { $sum: { $cond: ['$converted', 1, 0] } },
        },
      },
      { $sort: { leads: -1 } },
      { $limit: 7 },
    ]),
    Activity.find({ ...activityScope, status: 'planned' })
      .populate('activityType', 'name icon')
      .populate('assignedTo', 'name avatar')
      .sort('dueDate')
      .limit(6)
      .lean(),
    Lead.aggregate([
      { $match: scope },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 12 },
      { $sort: { _id: 1 } },
    ]),
    Opportunity.find({ ...scope, status: 'open' })
      .populate('stage', 'name color sequence')
      .populate('company', 'name')
      .populate('contact', 'name')
      .populate('salesperson', 'name avatar')
      .sort('-updatedAt')
      .limit(18)
      .lean(),
  ]);
  const s = summary[0] ?? {
    total: 0,
    pipelineValue: 0,
    wonRevenue: 0,
    won: 0,
    lost: 0,
  };
  res.json({
    summary: {
      ...s,
      totalLeads,
      newLeads,
      conversionRate:
        s.won + s.lost ? Math.round((s.won / (s.won + s.lost)) * 100) : 0,
      activitiesToday: activities[0]?.today[0]?.count ?? 0,
      activitiesOverdue: activities[0]?.overdue[0]?.count ?? 0,
    },
    pipeline,
    monthly,
    leadTrend,
    pipelineDeals,
    recentLeads,
    sources,
    attention,
  });
}
export async function report(req: Request, res: Response) {
  const dimension = String(req.query.dimension ?? 'stage');
  const measure = String(req.query.measure ?? 'expectedRevenue');
  const refs: Record<string, any> = {
    stage: PipelineStage,
    salesperson: User,
    salesTeam: SalesTeam,
    source: LeadSource,
    campaign: Campaign,
    lostReason: LostReason,
  };
  if (dimension !== 'month' && !refs[dimension])
    throw new ApiError(422, 'Invalid dimension');
  if (
    !['count', 'expectedRevenue', 'proratedRevenue', 'probability'].includes(
      measure,
    )
  )
    throw new ApiError(422, 'Invalid measure');
  const value =
    measure === 'count'
      ? { $sum: 1 }
      : measure === 'probability'
        ? { $avg: '$probability' }
        : {
            $sum:
              measure === 'proratedRevenue'
                ? {
                    $multiply: [
                      '$expectedRevenue',
                      { $divide: ['$probability', 100] },
                    ],
                  }
                : '$expectedRevenue',
          };
  const pipeline: any[] = [
    { $match: accessScope(req) },
    {
      $group: {
        _id:
          dimension === 'month'
            ? { $dateToString: { format: '%Y-%m', date: '$createdAt' } }
            : `$${dimension}`,
        value,
        count: { $sum: 1 },
      },
    },
  ];
  if (dimension !== 'month')
    pipeline.push(
      {
        $lookup: {
          from: refs[dimension].collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'label',
        },
      },
      { $set: { _id: { $ifNull: [{ $first: '$label.name' }, 'Unassigned'] } } },
      { $unset: 'label' },
    );
  pipeline.push({ $sort: dimension === 'month' ? { _id: 1 } : { value: -1 } });
  res.json(await Opportunity.aggregate(pipeline));
}

export async function metadata(_req: Request, res: Response) {
  const [
    stages,
    users,
    teams,
    tags,
    sources,
    campaigns,
    mediums,
    lostReasons,
    activityTypes,
  ] = await Promise.all([
    PipelineStage.find({ active: true }).sort('sequence'),
    User.find({ active: true }).select('name email avatar'),
    SalesTeam.find({ active: true }),
    Tag.find({ active: true }),
    LeadSource.find({ active: true }),
    Campaign.find({ active: true }),
    Medium.find({ active: true }),
    LostReason.find({ active: true }),
    ActivityType.find({ active: true }),
  ]);
  const customFields = await CustomField.find({ active: true })
    .sort('name')
    .lean();
  res.json({
    customFields,
    stages,
    users,
    teams,
    tags,
    sources,
    campaigns,
    mediums,
    lostReasons,
    activityTypes,
  });
}
export async function globalSearch(req: Request, res: Response) {
  const term = String(req.query.q ?? '').trim();
  if (term.length < 2)
    return res.json({ leads: [], deals: [], contacts: [], companies: [] });
  const match = new RegExp(escapeRegex(term), 'i'),
    scope = accessScope(req);
  const [leads, deals, contacts, companies] = await Promise.all([
    Lead.find({
      ...scope,
      $or: ['title', 'contactName', 'companyName', 'email', 'phone'].map(
        (field) => ({ [field]: match }),
      ),
    })
      .select('title contactName companyName email phone')
      .limit(6)
      .lean(),
    Opportunity.find({
      ...scope,
      $or: ['title', 'email', 'phone'].map((field) => ({ [field]: match })),
    })
      .select('title expectedRevenue company')
      .populate('company', 'name')
      .limit(6)
      .lean(),
    Contact.find({
      ...scope,
      $or: ['name', 'email', 'phone', 'mobile'].map((field) => ({
        [field]: match,
      })),
    })
      .select('name email phone company')
      .populate('company', 'name')
      .limit(6)
      .lean(),
    Company.find({
      ...scope,
      $or: ['name', 'email', 'phone'].map((field) => ({ [field]: match })),
    })
      .select('name industry email')
      .limit(6)
      .lean(),
  ]);
  res.json({ leads, deals, contacts, companies });
}
export async function checkDuplicates(req: Request, res: Response) {
  const email = String(req.query.email ?? '')
      .trim()
      .toLowerCase(),
    phone = String(req.query.phone ?? '').replace(/\D/g, ''),
    company = String(req.query.company ?? '').trim();
  const conditions: any[] = [];
  if (email) conditions.push({ email });
  if (phone.length >= 7)
    conditions.push({ phone: new RegExp(`${escapeRegex(phone.slice(-7))}$`) });
  if (company)
    conditions.push({
      companyName: new RegExp(`^${escapeRegex(company)}$`, 'i'),
    });
  if (!conditions.length) return res.json([]);
  res.json(
    await Lead.find({ ...accessScope(req), $or: conditions })
      .select('title contactName companyName email phone status')
      .limit(10)
      .lean(),
  );
}
export async function exportLeads(req: Request, res: Response) {
  const rows = await Lead.find(accessScope(req))
    .populate('salesperson', 'name')
    .populate('source', 'name')
    .sort('-createdAt')
    .limit(10000)
    .lean();
  const safe = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = [
    'Lead',
    'Contact',
    'Company',
    'Email',
    'Phone',
    'Status',
    'Deal Value',
    'Owner',
    'Source',
    'Created',
  ];
  const csv = [
    header,
    ...rows.map((lead: any) => [
      lead.title,
      lead.contactName,
      lead.companyName,
      lead.email,
      lead.phone,
      lead.status,
      lead.expectedRevenue,
      lead.salesperson?.name,
      lead.source?.name,
      lead.createdAt.toISOString(),
    ]),
  ]
    .map((row) => row.map(safe).join(','))
    .join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(`\uFEFF${csv}`);
}
export async function genericList(model: any, req: Request, res: Response) {
  res.json(await model.find({}).sort('name').limit(500));
}
export const models: Record<string, any> = {
  companies: Company,
  contacts: Contact,
  teams: SalesTeam,
  stages: PipelineStage,
  tags: Tag,
  sources: LeadSource,
  campaigns: Campaign,
  mediums: Medium,
  lostReasons: LostReason,
  activityTypes: ActivityType,
  activities: Activity,
  filters: SavedFilter,
  notifications: Notification,
  communications: Communication,
  workflows: Workflow,
  customFields: CustomField,
  emailTemplates: EmailTemplate,
  whatsappTemplates: WhatsAppTemplate,
  scoringRules: ScoringRule,
  auditLogs: AuditLog,
};
