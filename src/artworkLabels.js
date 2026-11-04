import { CATALOG_COLUMNS, catalogValue } from './catalog.js';
export const LABEL_FIELDS = CATALOG_COLUMNS;
export const DEFAULT_LABELS = { enabled: false, fields: ['title', 'artist', 'year', 'dimensions'] };
export function normalizeLabels(value) {
  return {
    enabled: value?.enabled === true,
    fields: Array.isArray(value?.fields)
      ? [...new Set(value.fields.filter((key) => LABEL_FIELDS.some(([id]) => id === key)))]
      : [...DEFAULT_LABELS.fields],
  };
}
export function artworkLabelRows(art, settings) {
  return settings.fields.flatMap((key) => {
    const value = catalogValue(art, key);
    if (value === '' || value === null) return [];
    const label = LABEL_FIELDS.find(([id]) => id === key)?.[1] || key;
    return [{ key, label, value: String(value) }];
  });
}
