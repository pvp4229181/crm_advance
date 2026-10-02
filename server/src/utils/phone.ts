export const normalizePhone = (value: unknown) =>
  String(value ?? '').replace(/\D/g, '');
export const phoneSuffix = (value: unknown) => normalizePhone(value).slice(-10);
