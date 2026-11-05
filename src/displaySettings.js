export const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
  beams: true,
  mezzanine: true,
  lightingRails: true,
  artworkList: 'cards',
});

export function validateDisplaySettings(project) {
  project.displaySettings = { ...DEFAULT_DISPLAY_SETTINGS, ...project.displaySettings };
  const s = project.displaySettings;
  if (
    !['beams', 'mezzanine', 'lightingRails'].every((key) => typeof s[key] === 'boolean') ||
    !['cards', 'compact'].includes(s.artworkList)
  )
    throw new Error('表示設定が不正です');
  return s;
}
