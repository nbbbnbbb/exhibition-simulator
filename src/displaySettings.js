export const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
  beams: true,
  mezzanine: true,
  lightingRails: true,
  artworkList: 'cards',
  floorLines: true,
  grid: false,
  dimensions: true,
  cutawayRoof: true,
  view: 'split',
  eyeHeight: 1600,
  libraryPanel: true,
  inspectorPanel: true,
});

export function validateDisplaySettings(project) {
  if (
    project.displaySettings != null &&
    (typeof project.displaySettings !== 'object' || Array.isArray(project.displaySettings))
  )
    throw new Error('表示設定が不正です');
  project.displaySettings = { ...DEFAULT_DISPLAY_SETTINGS, ...project.displaySettings };
  const s = project.displaySettings;
  if (
    ![
      'beams',
      'mezzanine',
      'lightingRails',
      'floorLines',
      'grid',
      'dimensions',
      'cutawayRoof',
      'libraryPanel',
      'inspectorPanel',
    ].every((key) => typeof s[key] === 'boolean') ||
    !['cards', 'compact'].includes(s.artworkList) ||
    !['three', 'plan', 'split'].includes(s.view) ||
    !Number.isInteger(s.eyeHeight) ||
    s.eyeHeight < 800 ||
    s.eyeHeight > 2100
  )
    throw new Error('表示設定が不正です');
  return s;
}
