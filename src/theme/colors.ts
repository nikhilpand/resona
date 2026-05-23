export const PantoneColors = {
  mediumSlate: '#7B68EE',
  ultraViolet: '#E040FB',
  crystalBlue: '#00BCD4',
  fiesta: '#FF6B6B',
  greenery: '#4CAF50',
  obsidian: '#0a0a0f',
  deepNavy: '#1a1a26',
  paleViolet: '#c4b8ff'
};

export const Theme = {
  dark: {
    background: PantoneColors.obsidian,
    surface: PantoneColors.deepNavy,
    primary: PantoneColors.mediumSlate,
    secondary: PantoneColors.ultraViolet,
    accent: PantoneColors.crystalBlue,
    error: PantoneColors.fiesta,
    success: PantoneColors.greenery,
    text: '#ffffff',
    textMuted: PantoneColors.paleViolet,
    border: 'rgba(255,255,255,0.06)',
  }
};
