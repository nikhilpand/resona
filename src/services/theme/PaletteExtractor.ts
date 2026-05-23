/**
 * PaletteExtractor — extracts dominant colors from an album art URL.
 *
 * Strategy (React Native compatible, no native module required):
 * 1. Fetch the image as a small 40x40 pixel thumbnail (fast)
 * 2. Read pixel data from a hidden Skia canvas (or fall back to hash-based seeding)
 * 3. Returns: primary, secondary, text, background tints
 *
 * Since true pixel-level extraction requires a native module (react-native-palette),
 * this uses a deterministic hash on the URL to pick from a curated set of
 * Pantone-inspired palettes — giving each song a unique, cohesive atmosphere.
 * Wire in react-native-palette for production.
 */

export interface SongPalette {
  /** Dominant album art color — used for glows and accents */
  primary: string;
  /** Secondary accent — used for gradients and highlights */
  secondary: string;
  /** Background tint (very dark version of primary) */
  backgroundTint: string;
  /** Glow color with opacity suffix for ambient effects */
  glow: string;
  /** Text shadow color */
  textGlow: string;
  /** Artwork shadow color */
  artworkShadow: string;
}

/** Curated Pantone-inspired palettes — each gives the full app a unique character */
const PALETTES: SongPalette[] = [
  // Slate Indigo — default
  { primary: '#7B68EE', secondary: '#9B8FFF', backgroundTint: '#0d0b1a', glow: 'rgba(123,104,238,0.22)', textGlow: 'rgba(123,104,238,0.6)', artworkShadow: '#7B68EE' },
  // Ultra Violet
  { primary: '#E040FB', secondary: '#F06AFD', backgroundTint: '#150b18', glow: 'rgba(224,64,251,0.2)', textGlow: 'rgba(224,64,251,0.55)', artworkShadow: '#E040FB' },
  // Crystal Blue
  { primary: '#00BCD4', secondary: '#26D4EE', backgroundTint: '#031418', glow: 'rgba(0,188,212,0.2)', textGlow: 'rgba(0,188,212,0.55)', artworkShadow: '#00BCD4' },
  // Fiesta Red
  { primary: '#FF6B6B', secondary: '#FF8A8A', backgroundTint: '#180909', glow: 'rgba(255,107,107,0.2)', textGlow: 'rgba(255,107,107,0.55)', artworkShadow: '#FF6B6B' },
  // Greenery
  { primary: '#4CAF50', secondary: '#6FC472', backgroundTint: '#071208', glow: 'rgba(76,175,80,0.2)', textGlow: 'rgba(76,175,80,0.55)', artworkShadow: '#4CAF50' },
  // Amber Gold
  { primary: '#FFB300', secondary: '#FFC940', backgroundTint: '#130f00', glow: 'rgba(255,179,0,0.2)', textGlow: 'rgba(255,179,0,0.55)', artworkShadow: '#FFB300' },
  // Rose Pink
  { primary: '#F06292', secondary: '#F48FB1', backgroundTint: '#180810', glow: 'rgba(240,98,146,0.2)', textGlow: 'rgba(240,98,146,0.55)', artworkShadow: '#F06292' },
  // Deep Teal
  { primary: '#26A69A', secondary: '#4DB6AC', backgroundTint: '#041210', glow: 'rgba(38,166,154,0.2)', textGlow: 'rgba(38,166,154,0.55)', artworkShadow: '#26A69A' },
  // Lavender
  { primary: '#AB47BC', secondary: '#CE93D8', backgroundTint: '#120b14', glow: 'rgba(171,71,188,0.2)', textGlow: 'rgba(171,71,188,0.55)', artworkShadow: '#AB47BC' },
  // Coral
  { primary: '#FF7043', secondary: '#FF8A65', backgroundTint: '#180a05', glow: 'rgba(255,112,67,0.2)', textGlow: 'rgba(255,112,67,0.55)', artworkShadow: '#FF7043' },
];

export class PaletteExtractor {
  /** Returns a stable palette for a given artwork URL (deterministic). */
  public static extractFromUrl(artworkUrl: string | undefined): SongPalette {
    if (!artworkUrl) return PALETTES[0];
    const hash = this.hashString(artworkUrl);
    return PALETTES[Math.abs(hash) % PALETTES.length];
  }

  /** Returns a stable palette for a given track ID (even faster lookup). */
  public static extractFromTrackId(trackId: string): SongPalette {
    const hash = this.hashString(trackId);
    return PALETTES[Math.abs(hash) % PALETTES.length];
  }

  /** djb2 hash — fast, consistent, well-distributed for short strings */
  private static hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit int
    }
    return hash;
  }
}
