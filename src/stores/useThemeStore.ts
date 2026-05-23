import { create } from 'zustand';
import Animated, {
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { PaletteExtractor, SongPalette } from '../services/theme/PaletteExtractor';

/**
 * Global reactive theme store — holds the current song's palette.
 * Components subscribe to this to get per-song color DNA.
 * Animated values live outside Zustand to avoid serialization overhead.
 */

interface ThemeState {
  palette: SongPalette;
  trackId: string | null;

  /** Call this whenever the active track changes. Triggers palette animation. */
  updatePalette: (trackId: string, artworkUrl?: string) => void;

  /** Reset to default slate theme */
  resetPalette: () => void;
}

const DEFAULT_PALETTE = PaletteExtractor.extractFromUrl(undefined);

export const useThemeStore = create<ThemeState>((set, get) => ({
  palette: DEFAULT_PALETTE,
  trackId: null,

  updatePalette: (trackId, artworkUrl) => {
    if (get().trackId === trackId) return; // Already showing this track's palette

    const newPalette = artworkUrl
      ? PaletteExtractor.extractFromUrl(artworkUrl)
      : PaletteExtractor.extractFromTrackId(trackId);

    set({ palette: newPalette, trackId });
  },

  resetPalette: () => {
    set({ palette: DEFAULT_PALETTE, trackId: null });
  },
}));
