import { phoneSuffix } from '../utils/phone.js';
import { leadInput } from '../validators/index.js';
import type { Request, Response } from 'express';
import { Lead, TimelineEvent, CustomField, AuditLog } from '../models/index.js';
import { accessScope, scopedFilter } from '../middleware/auth.js';
import { ApiError } from '../utils/http.js';
import { runWorkflows } from '../services/workflow.service.js';

const allowed = [
  'title',
  'contactName',
  'companyName',
  'email',
  'phone',
  'expectedRevenue',
  'priority',
  'notes',
] as const;
type Field = (typeof allowed)[number];
type ImportRow = {
  row: number;
  data: Record<string, string>;
  errors: string[];
  duplicate?: { _id?: unknown; title: string };
};
export async function importLeads(req: Request, res: Response) {
  const {
    rows,
    mapping,
    confirm = false,
  } = req.body as {
    rows?: Record<string, unknown>[];
    mapping?: Record<string, string>;
    confirm?: boolean;
  };
  if (
    !Array.isArray(rows) ||
    !mapping ||
    typeof mapping !== 'object' ||
    Array.isArray(mapping) ||
    typeof confirm !== 'boolean'
  )
    throw new ApiError(422, 'Rows and column mapping are required');
  if (
    !rows.length ||
    rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    throw new ApiError(
      422,
      'Provide at least one row, with each row an object',
    );
  if (rows.length > 2000)
    throw new ApiError(422, 'Import is limited to 2,000 rows at a time');
  const mapped = Object.entries(mapping).filter(([, field]) =>
    allowed.includes(field as Field),
  );
  if (!mapped.some(([, field]) => field === 'title'))
    throw new ApiError(422, 'Map one CSV column to Lead title');
  const requiredFields = await CustomField.find({
    entity: 'Lead',
    active: true,
    required: true,
  })
    .select('name')
    .lean();
  if (requiredFields.length)
    throw new ApiError(
      422,
      `CSV import does not include required custom fields: ${requiredFields.map((field) => field.name).join(', ')}. Add leads through the lead form or make those fields optional before importing.`,
    );
  if (new Set(mapped.map(([, field]) => field)).size !== mapped.length)
    throw new ApiError(422, 'Map each lead field to only one CSV column');
  const normalizedRows = rows.map((row) =>
    Object.fromEntries(
      mapped.map(([column, field]) => [
        field,
        String(row?.[column] ?? '').trim(),
      ]),
    ),
  );
  const emails = normalizedRows
    .map((row) => row.email?.toLowerCase())
    .filter(Boolean);
  const phones = normalizedRows
    .map((row) => phoneSuffix(row.phone))
    .filter((phone) => phone.length >= 7);
  const existing =
    emails.length || phones.length
      ? await Lead.find(
          scopedFilter(req, {
            $or: [{ email: { $in: emails } }, { phoneSuffix: { $in: phones } }],
          }),
        )
          .select('title email phoneSuffix')
          .lean()
      : [];
  const byEmail = new Map(
    existing.filter((row) => row.email).map((row) => [row.email!, row]),
  );
  const byPhone = new Map(
    existing
      .filter((row) => row.phoneSuffix)
      .map((row) => [row.phoneSuffix!, row]),
  );
  const reviewed: ImportRow[] = [];
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    const data: Record<string, string> = normalizedRows[index]!;
    const errors: string[] = [];
    if (!data.title || data.title.length < 2)
      errors.push('Lead title is required');
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      errors.push('Invalid email');
    if (
      data.expectedRevenue &&
      (!Number.isFinite(Number(data.expectedRevenue)) ||
        Number(data.expectedRevenue) < 0)
    )
      errors.push('Invalid deal value');
    if (data.priority && !['0', '1', '2', '3'].includes(data.priority))
      errors.push('Priority must be 0, 1, 2, or 3');
    const normalizedEmail = data.email?.toLowerCase();
    const digits = phoneSuffix(data.phone);
    const duplicateInFile = Boolean(
      (normalizedEmail && seenEmails.has(normalizedEmail)) ||
      (digits.length >= 7 && seenPhones.has(digits)),
    );
    const databaseDuplicate =
      (normalizedEmail ? byEmail.get(normalizedEmail) : undefined) ??
      (digits.length >= 7 ? byPhone.get(digits) : undefined);
    const duplicate =
      databaseDuplicate ??
      (duplicateInFile ? { title: 'Another row in this CSV' } : null);
    const parsed = leadInput.safeParse({
      ...data,
      expectedRevenue: Number(data.expectedRevenue || 0),
      priority: Number(data.priority || 1),
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        if (!errors.includes(issue.message)) errors.push(issue.message);
    // Invalid rows must not reserve a contact and block a later corrected row.
    if (!errors.length && !duplicate) {
      if (normalizedEmail) seenEmails.add(normalizedEmail);
      if (digits.length >= 7) seenPhones.add(digits);
    }
    reviewed.push({
      row: index + 2,
      data,
      errors,
      ...(duplicate
        ? {
            duplicate: {
              ...('_id' in duplicate ? { _id: duplicate._id } : {}),
              title: duplicate.title,
            },
          }
        : {}),
    });
  }
  const valid = reviewed.filter((row) => !row.errors.length && !row.duplicate);
  if (!confirm)
    return res.json({
      total: reviewed.length,
      valid: valid.length,
      duplicates: reviewed.filter((x) => x.duplicate).length,
      invalid: reviewed.filter((x) => x.errors.length).length,
      rows: reviewed,
    });
  const created = await Lead.insertMany(
    valid.map((row) => ({
      ...row.data,
      email: row.data.email?.toLowerCase() || undefined,
      expectedRevenue: Number(row.data.expectedRevenue || 0),
      priority: Math.min(3, Math.max(0, Number(row.data.priority || 1))),
      salesperson: req.user!._id,
      createdBy: req.user!._id,
      updatedBy: req.user!._id,
    })),
    { ordered: false },
  );
  if (created.length)
    await AuditLog.insertMany(
      created.map((lead) => ({
        actor: req.user!._id,
        action: 'imported',
        entityType: 'Lead',
        entityId: lead._id,
      })),
    );
  if (created.length)
    await TimelineEvent.insertMany(
      created.map((lead) => ({
        createdBy: req.user!._id,
        relatedModel: 'Lead',
        relatedId: lead._id,
        eventType: 'lead_imported',
        message: 'Lead imported from CSV',
      })),
    );
  await runWorkflows(
    'lead_created',
    created.map((lead) => lead.toObject()),
    req.user!._id,
  );
  res.status(201).json({
    total: reviewed.length,
    valid: valid.length,
    imported: created.length,
    skipped: reviewed.length - created.length,
    duplicates: reviewed.filter((x) => x.duplicate).length,
    invalid: reviewed.filter((x) => x.errors.length).length,
    rows: reviewed,
  });
}
