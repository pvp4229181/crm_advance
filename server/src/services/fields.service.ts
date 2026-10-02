import { CustomField, ScoringRule } from '../models/index.js';
import { ApiError } from '../utils/http.js';

export async function validateCustomValues(
  entity: string,
  input: any,
  current: any = {},
) {
  const fields = await CustomField.find({ entity, active: true }).lean();
  const values: Record<string, unknown> = {
    ...(current.customValues ?? {}),
    ...(input.customValues ?? {}),
  };
  const known = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(input.customValues ?? {}))
    if (
      !known.has(key) &&
      JSON.stringify(input.customValues[key]) !==
        JSON.stringify(current.customValues?.[key])
    )
      throw new ApiError(422, `Unknown custom field: ${key}`);
  for (const field of fields) {
    const value = values[field.key];
    const empty =
      value == null || value === '' || (Array.isArray(value) && !value.length);
    if (empty) {
      if (field.required) throw new ApiError(422, `${field.name} is required`);
      continue;
    }
    let valid = true;
    switch (field.fieldType) {
      case 'number':
      case 'currency':
        valid = typeof value === 'number' && Number.isFinite(value);
        break;
      case 'checkbox':
        valid = typeof value === 'boolean';
        break;
      case 'dropdown':
        valid = typeof value === 'string' && field.options.includes(value);
        break;
      case 'multi-select':
        valid =
          Array.isArray(value) &&
          value.every(
            (item) => typeof item === 'string' && field.options.includes(item),
          );
        break;
      case 'date':
        valid =
          typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value;
        break;
      case 'url':
        valid =
          typeof value === 'string' &&
          /^https?:\/\//i.test(value) &&
          URL.canParse(value);
        break;
      default:
        valid = typeof value === 'string' && value.length <= 10000;
    }
    if (!valid) throw new ApiError(422, `${field.name} has an invalid value`);
  }
  if (input.customValues !== undefined) input.customValues = values;
  return input;
}

export function calculateScore(record: any, rules: any[]) {
  return rules.reduce((score, rule) => {
    const raw = record[rule.field];
    const value = raw?._id ?? raw;
    const exists = value != null && value !== '';
    const match =
      rule.operator === 'exists'
        ? exists
        : rule.operator === 'equals'
          ? String(value ?? '').toLowerCase() ===
            String(rule.value ?? '').toLowerCase()
          : rule.operator === 'contains'
            ? String(value ?? '')
                .toLowerCase()
                .includes(String(rule.value ?? '').toLowerCase())
            : rule.operator === 'greater_than'
              ? exists && Number(value) > Number(rule.value)
              : exists && Number(value) < Number(rule.value);
    return score + (match ? rule.points : 0);
  }, 0);
}

export async function scoredLeads(records: any[]) {
  const rules = await ScoringRule.find({ active: true }).lean();
  return records.map((record) => {
    const data = record.toObject ? record.toObject() : record;
    return { ...data, score: calculateScore(data, rules) };
  });
}

export function validateConfiguration(
  path: string,
  input: any,
  current: any = {},
) {
  const record = { ...current, ...input };
  if (path === 'customFields') {
    if (
      current._id &&
      ['key', 'entity', 'fieldType'].some(
        (key) => input[key] !== undefined && input[key] !== current[key],
      )
    )
      throw new ApiError(
        409,
        'The key, record type, and value type of an existing custom field cannot change',
      );
    if (
      ['dropdown', 'multi-select'].includes(record.fieldType) &&
      (!record.options?.length ||
        new Set(record.options).size !== record.options.length)
    )
      throw new ApiError(422, 'Choose at least one distinct option');
  }
  if (path === 'scoringRules') {
    if (
      record.operator !== 'exists' &&
      (record.value == null || record.value === '')
    )
      throw new ApiError(422, 'A comparison value is required');
    if (
      ['greater_than', 'less_than'].includes(record.operator) &&
      (!['expectedRevenue', 'priority'].includes(record.field) ||
        !Number.isFinite(Number(record.value)))
    )
      throw new ApiError(
        422,
        'Numeric comparisons require a numeric field and value',
      );
  }
}
