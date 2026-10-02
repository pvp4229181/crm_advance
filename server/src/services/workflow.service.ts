import type mongoose from 'mongoose';
import {
  Activity,
  ActivityType,
  Communication,
  Lead,
  Notification,
  Opportunity,
  SalesTeam,
  Tag,
  TimelineEvent,
  User,
  WhatsAppTemplate,
  Workflow,
} from '../models/index.js';
import type { workflowEvents } from '../validators/index.js';
import {
  assertWindowOpen,
  deliverTemplate,
  renderTemplate,
  sendWhatsAppText,
} from './whatsapp.service.js';

export type WorkflowEvent = (typeof workflowEvents)[number];
type Actor = mongoose.Types.ObjectId;

// Refs may arrive populated ({_id,name}) or raw, depending on which controller fired the event.
const idOf = (value: any) =>
  (value?._id ?? value ?? null) as mongoose.Types.ObjectId | null;
const same = (a: any, b: any) =>
  String(idOf(a) ?? '') === String(idOf(b) ?? '');
const fill = (text: string, record: any) =>
  text
    .replace(/\{(title|contactName|companyName)\}/g, (_m, key) =>
      String(record[key] ?? ''),
    )
    .trim();

function matches(conditions: any, record: any) {
  if (conditions.source && !same(record.source, conditions.source))
    return false;
  if (conditions.status && record.status !== conditions.status) return false;
  if (conditions.stage && !same(record.stage, conditions.stage)) return false;
  if (
    conditions.minRevenue != null &&
    (record.expectedRevenue ?? 0) < conditions.minRevenue
  )
    return false;
  if (
    conditions.minPriority != null &&
    (record.priority ?? 0) < conditions.minPriority
  )
    return false;
  return true;
}

async function ownerPool(team: unknown) {
  if (team) {
    const found: any = await SalesTeam.findById(team).lean();
    if (!found) throw new Error('The round-robin sales team no longer exists');
    const ids = [found.teamLeader, ...(found.members ?? [])];
    return (
      await User.find({ _id: { $in: ids }, active: true })
        .select('_id')
        .sort('_id')
        .lean()
    ).map((user) => user._id);
  }
  return (
    await User.find({ active: true }).select('_id').sort('_id').lean()
  ).map((user) => user._id);
}

// Actions write to the database directly, never through the controllers, so a workflow cannot re-trigger itself.
async function runAction(
  flow: any,
  action: any,
  record: any,
  relatedModel: 'Lead' | 'Opportunity',
  actor: Actor,
): Promise<string> {
  const Model: any = relatedModel === 'Lead' ? Lead : Opportunity;
  const link = `/${relatedModel === 'Lead' ? 'leads' : 'opportunities'}/${record._id}`;
  const config = action.config ?? {};
  switch (action.type) {
    case 'assign_owner': {
      if (config.onlyIfUnassigned !== false && idOf(record.salesperson))
        return 'kept the existing owner';
      let ownerId = config.user;
      if (!ownerId) {
        const pool = await ownerPool(config.team);
        if (!pool.length)
          throw new Error(
            'No active users are available for round-robin assignment',
          );
        const before: any = await Workflow.findByIdAndUpdate(
          flow._id,
          { $inc: { rrCursor: 1 } },
          { projection: { rrCursor: 1 } },
        ).lean();
        ownerId = pool[(before?.rrCursor ?? 0) % pool.length];
      }
      const owner = await User.findOne({ _id: ownerId, active: true })
        .select('name')
        .lean();
      if (!owner)
        throw new Error('The chosen owner is inactive or was removed');
      const update: any = { salesperson: owner._id, updatedBy: actor };
      if (config.team) update.salesTeam = config.team;
      await Model.updateOne({ _id: record._id }, update);
      Object.assign(record, update);
      if (!same(owner._id, actor))
        await Notification.create({
          user: owner._id,
          title: `${relatedModel === 'Lead' ? 'Lead' : 'Opportunity'} assigned`,
          message: record.title,
          type: 'assignment',
          link,
        });
      return `assigned to ${owner.name}`;
    }
    case 'create_activity': {
      const type: any = await ActivityType.findById(config.activityType).lean();
      if (!type) throw new Error('The activity type no longer exists');
      const days = config.days ?? type.defaultDays ?? 1;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + days);
      const summary =
        fill(config.summary || `${type.name}: {title}`, record) || type.name;
      await Activity.create({
        activityType: type._id,
        dueDate,
        assignedTo: idOf(record.salesperson) ?? actor,
        summary,
        relatedModel,
        relatedId: record._id,
        createdBy: actor,
      });
      return `created ${type.name} “${summary}” due in ${days} day${days === 1 ? '' : 's'}`;
    }
    case 'notify': {
      const to = config.user ?? idOf(record.salesperson);
      if (!to) return 'skipped the notification (no owner to notify)';
      await Notification.create({
        user: to,
        title: flow.name,
        message: fill(config.message || record.title, record),
        type: 'workflow',
        link,
      });
      return 'sent a notification';
    }
    case 'add_tag': {
      const tag: any = await Tag.findById(config.tag).select('name').lean();
      if (!tag) throw new Error('The tag no longer exists');
      await Model.updateOne(
        { _id: record._id },
        { $addToSet: { tags: tag._id }, $set: { updatedBy: actor } },
      );
      return `tagged “${tag.name}”`;
    }
    case 'set_priority': {
      await Model.updateOne(
        { _id: record._id },
        { priority: config.priority, updatedBy: actor },
      );
      record.priority = config.priority;
      return `set priority to ${config.priority}`;
    }
    case 'add_note': {
      await TimelineEvent.create({
        createdBy: actor,
        relatedModel,
        relatedId: record._id,
        eventType: 'note_added',
        message: fill(config.message, record),
      });
      return 'added a note';
    }
    case 'send_whatsapp': {
      if (!record.phone)
        throw new Error('This record has no phone number for WhatsApp');
      const metadata: Record<string, unknown> = { workflow: flow._id };
      let body: string,
        providerMessageId: string,
        template: any = null;
      if (config.template) {
        template = await WhatsAppTemplate.findOne({
          _id: config.template,
          active: true,
        }).lean();
        if (!template)
          throw new Error('The WhatsApp template was removed or deactivated');
        const rendered = await renderTemplate(template, record);
        if (rendered.missing.length)
          throw new Error(
            `Template “${template.name}” has no value for ${rendered.missing.join(', ')}`,
          );
        providerMessageId = await deliverTemplate(
          record.phone,
          template,
          rendered,
        );
        body = rendered.text;
        metadata.template = {
          id: template._id,
          name: template.name,
          language: template.language,
        };
      } else {
        await assertWindowOpen(record.phone);
        body = fill(config.message, record);
        providerMessageId = await sendWhatsAppText(record.phone, body);
      }
      await Communication.create({
        channel: 'whatsapp',
        direction: 'outbound',
        provider: 'meta-cloud-api',
        providerMessageId,
        status: 'sent',
        body,
        relatedModel,
        relatedId: record._id,
        sender: process.env.WHATSAPP_BUSINESS_NUMBER,
        recipient: record.phone,
        createdBy: actor,
        metadata,
      });
      return template
        ? `sent the WhatsApp template “${template.name}”`
        : 'sent a WhatsApp message';
    }
    default:
      throw new Error(`Unknown action “${action.type}”`);
  }
}

/**
 * Runs every active workflow for `event` against each record, in creation order.
 * Never throws: a failing workflow stops at the failed action and records why on the record's timeline.
 * Returns how many workflow runs touched a record, so callers know whether to reload it.
 */
export async function runWorkflows(
  event: WorkflowEvent,
  records: any[],
  actor: Actor,
): Promise<number> {
  if (!records.length) return 0;
  let ran = 0;
  try {
    const flows: any[] = await Workflow.find({
      active: true,
      'trigger.event': event,
    })
      .sort('createdAt')
      .lean();
    if (!flows.length) return 0;
    const relatedModel = event.startsWith('lead_') ? 'Lead' : 'Opportunity';
    for (const record of records)
      for (const flow of flows) {
        if (!matches(flow.trigger?.conditions ?? {}, record)) continue;
        ran++;
        const done: string[] = [];
        try {
          for (const action of flow.actions ?? [])
            done.push(
              await runAction(flow, action, record, relatedModel, actor),
            );
          await TimelineEvent.create({
            createdBy: actor,
            relatedModel,
            relatedId: record._id,
            eventType: 'workflow_ran',
            message: `Workflow “${flow.name}”: ${done.join('; ')}`,
            metadata: { workflow: flow._id },
          });
          await Workflow.updateOne(
            { _id: flow._id },
            {
              $inc: { runs: 1 },
              $set: { lastRunAt: new Date() },
              $unset: { lastError: 1 },
            },
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          await TimelineEvent.create({
            createdBy: actor,
            relatedModel,
            relatedId: record._id,
            eventType: 'workflow_failed',
            message: `Workflow “${flow.name}” failed${done.length ? ` after it ${done.join('; ')}` : ''}: ${message}`,
            metadata: { workflow: flow._id },
          }).catch(console.error);
          await Workflow.updateOne(
            { _id: flow._id },
            {
              $inc: { runs: 1, failures: 1 },
              $set: { lastRunAt: new Date(), lastError: message },
            },
          ).catch(console.error);
        }
      }
  } catch (error) {
    console.error(`Workflows for ${event} could not run`, error);
  }
  return ran;
}
