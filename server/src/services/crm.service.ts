import mongoose from 'mongoose';
import {
  Company,
  AuditLog,
  Contact,
  Lead,
  Notification,
  Opportunity,
  PipelineStage,
  TimelineEvent,
} from '../models/index.js';
import { ApiError } from '../utils/http.js';
export async function convertLead(
  leadId: string,
  userId: mongoose.Types.ObjectId,
  scope: Record<string, unknown>,
) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const lead = await Lead.findOne({
        $and: [scope, { _id: leadId, converted: false }],
      }).session(session);
      if (!lead)
        throw new ApiError(409, 'Lead was already converted or does not exist');
      let company = lead.companyName
        ? await Company.findOne({
            name: lead.companyName,
            salesperson: lead.salesperson,
          }).session(session)
        : null;
      if (!company && lead.companyName)
        company = await new Company({
          name: lead.companyName,
          email: lead.email,
          phone: lead.phone,
          salesperson: lead.salesperson,
        }).save({ session });
      let contact = lead.email
        ? await Contact.findOne({
            email: lead.email,
            salesperson: lead.salesperson,
          }).session(session)
        : null;
      if (!contact && lead.contactName)
        contact = await new Contact({
          name: lead.contactName,
          company: company?._id,
          email: lead.email,
          phone: lead.phone,
          salesperson: lead.salesperson,
        }).save({ session });
      const stage: any = await PipelineStage.findOne({ active: true })
        .sort('sequence')
        .session(session);
      if (!stage)
        throw new ApiError(
          422,
          'Configure a pipeline stage before converting leads',
        );
      const [opportunity] = await Opportunity.create(
        [
          {
            title: lead.title,
            customValues: {},
            company: company?._id,
            contact: contact?._id,
            email: lead.email,
            phone: lead.phone,
            expectedRevenue: lead.expectedRevenue,
            priority: lead.priority,
            salesperson: lead.salesperson,
            salesTeam: lead.salesTeam,
            tags: lead.tags,
            source: lead.source,
            medium: lead.medium,
            campaign: lead.campaign,
            stage: stage._id,
            probability: stage.probability,
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        { session, ordered: true },
      );
      await AuditLog.create(
        [
          {
            actor: userId,
            action: 'converted',
            entityType: 'Lead',
            entityId: lead._id,
            changes: { opportunity: opportunity!._id },
          },
          {
            actor: userId,
            action: 'created',
            entityType: 'Opportunity',
            entityId: opportunity!._id,
            changes: { lead: lead._id },
          },
        ],
        { session, ordered: true },
      );
      lead.converted = true;
      lead.status = 'converted';
      lead.convertedOpportunity = opportunity!._id;
      lead.updatedBy = userId;
      await lead.save({ session });
      await TimelineEvent.create(
        [
          {
            createdBy: userId,
            relatedModel: 'Lead',
            relatedId: lead._id,
            eventType: 'lead_converted',
            message: 'Lead converted to an opportunity',
          },
          {
            createdBy: userId,
            relatedModel: 'Opportunity',
            relatedId: opportunity!._id,
            eventType: 'opportunity_created',
            message: `Converted from lead “${lead.title}”`,
          },
        ],
        { session, ordered: true },
      );
      if (lead.salesperson)
        await Notification.create(
          [
            {
              user: lead.salesperson,
              title: 'Opportunity assigned',
              message: lead.title,
              type: 'assignment',
              link: `/opportunities/${opportunity!._id}`,
            },
          ],
          { session, ordered: true },
        );
      return opportunity;
    });
  } finally {
    await session.endSession();
  }
}
export async function moveOpportunity(
  id: string,
  stageId: string,
  orderedIds: string[],
  userId: mongoose.Types.ObjectId,
  scope: Record<string, unknown>,
) {
  return mongoose.connection.transaction(async (session) => {
    const before = await Opportunity.findOne({
      $and: [scope, { _id: id, status: 'open' }],
    }).session(session);
    if (!before) throw new ApiError(404, 'Open opportunity not found');
    const stage: any = await PipelineStage.findOne({
      _id: stageId,
      active: true,
    }).session(session);
    if (!stage) throw new ApiError(422, 'Stage is unavailable');
    const permitted = await Opportunity.countDocuments({
      $and: [
        scope,
        {
          _id: { $in: orderedIds },
          status: 'open',
          $or: [{ stage: stageId }, { _id: id }],
        },
      ],
    }).session(session);
    if (permitted !== orderedIds.length)
      throw new ApiError(
        403,
        'The move includes inaccessible records or records from another stage',
      );
    const remaining = await Opportunity.find({
      $and: [
        scope,
        { stage: stageId, status: 'open', _id: { $nin: orderedIds } },
      ],
    })
      .select('_id')
      .sort({ kanbanOrder: 1, _id: 1 })
      .session(session)
      .lean();
    const completeOrder = [
      ...orderedIds,
      ...remaining.map((record) => String(record._id)),
    ];
    await Opportunity.bulkWrite(
      completeOrder.map((opportunityId, index) => ({
        updateOne: {
          filter: { $and: [scope, { _id: opportunityId, status: 'open' }] },
          update: {
            $set: {
              stage: stage._id,
              kanbanOrder: index,
              updatedBy: userId,
              ...(opportunityId === id
                ? {
                    probability: stage.probability,
                    status: stage.isWon ? ('won' as const) : ('open' as const),
                    wonAt: stage.isWon ? new Date() : null,
                  }
                : {}),
            },
          },
        },
      })),
      { session, ordered: true },
    );
    const changed = String(before.stage) !== stageId;
    if (changed)
      await TimelineEvent.create(
        [
          {
            createdBy: userId,
            relatedModel: 'Opportunity',
            relatedId: id,
            eventType: stage.isWon ? 'opportunity_won' : 'stage_changed',
            message: `Stage changed to ${stage.name}`,
          },
        ],
        { session, ordered: true },
      );
    await AuditLog.create(
      [
        {
          actor: userId,
          action: 'moved',
          entityType: 'Opportunity',
          entityId: before._id,
          changes: { previousStage: before.stage, stage: stage._id },
        },
      ],
      { session, ordered: true },
    );
    return changed;
  });
}
