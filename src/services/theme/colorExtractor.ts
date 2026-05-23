import { PantoneColors } from '../../theme/colors';

export interface ExtractedPalette {
  backdrop: string;      // Deep obsidian-like background
  cardBg: string;        // Deep navy card/surface backdrop
  primaryText: string;   // High-contrast title text
  accentColor: string;   // Core glow / primary accent
  subtleText: string;    // Pale violet text detail
  success: string;       // Positive action green
  error: string;         // Warning/danger red
}

export class ColorExtractor {
  /**
   * Generates a simple numeric hash from a string.
   */
  private static hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to a 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Deterministically generates a gorgeous 5-tone palette from song details.
   */
  public static extractFromMetadata(artist: string, title: string): ExtractedPalette {
    const seed = artist + ' - ' + title;
    const hash = this.hashString(seed);
    
    // 1. Generate base hue (0-360)
    const baseHue = hash % 360;

    // 2. Compute contrasting accent colors in HSL space
    const backdrop = `hsl(${baseHue}, 35%, 5%)`;        // 5% lightness = deep dark obsidian
    const cardBg = `hsl(${baseHue}, 25%, 11%)`;          // 11% lightness = navy card
    const primaryText = `hsl(${baseHue}, 20%, 96%)`;     // 96% lightness = clean off-white
    const accentColor = `hsl(${(baseHue + 140) % 360}, 75%, 68%)`; // Complementary accent hue
    const subtleText = `hsl(${baseHue}, 35%, 82%)`;      // Pale violet style contrast text
    
    return {
      backdrop,
      cardBg,
      primaryText,
      accentColor,
      subtleText,
      success: PantoneColors.greenery,
      error: PantoneColors.fiesta
    };
  }

  /**
   * Fallback to the standard default theme palette.
   */
  public static getDefaultPalette(): ExtractedPalette {
    return {
      backdrop: PantoneColors.obsidian,
      cardBg: PantoneColors.deepNavy,
      primaryText: '#ffffff',
      accentColor: PantoneColors.mediumSlate,
      subtleText: PantoneColors.paleViolet,
      success: PantoneColors.greenery,
      error: PantoneColors.fiesta
    };
  }
}
