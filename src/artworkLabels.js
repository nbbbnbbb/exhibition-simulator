import { CATALOG_COLUMNS, catalogValue } from './catalog.js';
export const LABEL_FIELDS = CATALOG_COLUMNS;
export const LABEL_STYLE_LIMITS = {
  fontSize: [10, 48],
  lineHeight: [120, 220],
  width: [200, 2000],
  gap: [0, 1000],
};
export const DEFAULT_LABELS = {
  enabled: false,
  fields: ['title', 'artist', 'year', 'dimensions'],
  fontSize: 16,
  lineHeight: 150,
  width: 650,
  gap: 90,
  position: 'above',
};
export function validateLabels(project) {
  if (
    project.artworkLabels != null &&
    (typeof project.artworkLabels !== 'object' || Array.isArray(project.artworkLabels))
  )
    throw new Error('作品情報の表示設定が不正です');
  const settings = { ...structuredClone(DEFAULT_LABELS), ...project.artworkLabels };
  if (
    typeof settings.enabled !== 'boolean' ||
    !['above', 'overlay'].includes(settings.position) ||
    !Array.isArray(settings.fields) ||
    settings.fields.length > LABEL_FIELDS.length ||
    !settings.fields.every((key) => LABEL_FIELDS.some(([id]) => id === key)) ||
    new Set(settings.fields).size !== settings.fields.length ||
    !Object.entries(LABEL_STYLE_LIMITS).every(
      ([key, [min, max]]) =>
        Number.isInteger(settings[key]) && settings[key] >= min && settings[key] <= max,
    )
  )
    throw new Error('作品情報の表示設定が不正です');
  project.artworkLabels = settings;
  return settings;
}
export function normalizeLabels(value) {
  return {
    ...DEFAULT_LABELS,
    position: ['above', 'overlay'].includes(value?.position)
      ? value.position
      : DEFAULT_LABELS.position,
    ...Object.fromEntries(
      Object.entries(LABEL_STYLE_LIMITS).map(([key, [min, max]]) => [
        key,
        Number.isInteger(value?.[key]) && value[key] >= min && value[key] <= max
          ? value[key]
          : DEFAULT_LABELS[key],
      ]),
    ),
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
