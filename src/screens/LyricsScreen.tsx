import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { ArrowLeft, MessageSquare, X } from 'lucide-react-native';
import { Theme } from '../theme/colors';
import { Typography } from '../theme/typography';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeStore } from '../stores/useThemeStore';
import { LyricsClient } from '../services/lyrics/LyricsClient';
import { LyricLine } from '../services/lyrics/LrcParser';
import { SyncedLyricsList } from '../components/lyrics/SyncedLyricsList';
import { useScrollLock } from '../hooks/useScrollLock';
import TrackPlayer, { useProgress } from 'react-native-track-player';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

// Mock Genius annotations mapped by text fragment
const MOCK_ANNOTATIONS: Record<string, string> = {
  'Far away': 'This opening line sets up the theme of emotional separation and seeking refuge, which is reflected in the track\'s ambient soundscape.',
  'Now I see the light': 'A focal moment of clarity. The composition transitions from minor progressions to bright major scales, symbolizing hope.',
  'Taking over my soul': 'Complete audio immersion. The lyric mirrors the user being "wowed" by the visual and auditory sync of the player.',
};

interface LyricsScreenProps {
  onBack: () => void;
}

export const LyricsScreen: React.FC<LyricsScreenProps> = ({ onBack }) => {
  const activeTrack = usePlaybackStore((state) => state.activeTrack);
  const currentLyricLineIndex = usePlaybackStore((state) => state.currentLyricLineIndex);
  const setLyricIndex = usePlaybackStore((state) => state.setLyricIndex);
  
  const progress = useProgress(100); // Check progress every 100ms
  
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const { isLocked, activateLock } = useScrollLock();
  
  // Pull palette from the global theme store (same source as NowPlayingScreen)
  const palette = useThemeStore((s) => s.palette);
  const updatePalette = useThemeStore((s) => s.updatePalette);

  // Genius annotations panel states
  const [activeFragment, setActiveFragment] = useState<string | null>(null);
  const [activeCommentary, setActiveCommentary] = useState<string | null>(null);
  const sheetTranslateY = useSharedValue(300); // Slide-up starting position

  // Sync palette and load lyrics when track changes
  useEffect(() => {
    const track = activeTrack;
    if (!track) return;

    // Ensure lyrics screen uses same palette as NowPlaying
    updatePalette(track.id, track.artwork as string | undefined);

    const trackId = track.id;
    const trackArtist = track.artist || 'Unknown';
    const trackTitle = track.title || 'Unknown';
    const trackDuration = track.duration || 0;

    async function loadLyrics() {
      const res = await LyricsClient.getLyrics(
        trackId,
        trackArtist,
        trackTitle,
        trackDuration
      );
      setLyrics(res.lyrics);
    }
    loadLyrics();
  }, [activeTrack]);

  // Binary search to find the active lyric index based on current playback milliseconds
  useEffect(() => {
    if (lyrics.length === 0) return;
    const curPosMs = progress.position * 1000;

    let low = 0;
    let high = lyrics.length - 1;
    let activeIdx = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lyrics[mid].timeMs <= curPosMs) {
        if (mid === lyrics.length - 1 || lyrics[mid + 1].timeMs > curPosMs) {
          activeIdx = mid;
          break;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (activeIdx !== currentLyricLineIndex) {
      setLyricIndex(activeIdx);
    }
  }, [progress.position, lyrics, currentLyricLineIndex]);

  const handleLinePress = async (timeMs: number) => {
    // 1. Seek player to selected timestamp
    await TrackPlayer.seekTo(timeMs / 1000);

    // 2. Find matching lyric text
    const clickedLine = lyrics.find((l) => l.timeMs === timeMs);
    if (!clickedLine) return;

    // 3. If line has an annotation, slide up the bottom panel
    const commentary = MOCK_ANNOTATIONS[clickedLine.text];
    if (commentary) {
      setActiveFragment(clickedLine.text);
      setActiveCommentary(commentary);
      sheetTranslateY.value = withSpring(0, { damping: 15 });
    } else {
      handleCloseAnnotations();
    }
  };

  const handleCloseAnnotations = () => {
    sheetTranslateY.value = withSpring(300, { damping: 15 });
    setActiveFragment(null);
    setActiveCommentary(null);
  };

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  if (!activeTrack) return null;

  return (
    <View style={[styles.container, { backgroundColor: palette.backgroundTint }]}>
      {/* Dynamic Per-Song Ambient Glow */}
      <View style={[styles.glowOverlay, { backgroundColor: palette.glow }]} />

      {/* Header */}
      <View style={[styles.header, { borderColor: palette.primary + '20' }]}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <ArrowLeft color={palette.primary} size={22} />
        </Pressable>
        <View style={styles.headerDetails}>
          <Text style={[styles.songTitle, { color: '#fff' }]} numberOfLines={1}>{activeTrack.title}</Text>
          <Text style={[styles.artistName, { color: palette.primary }]} numberOfLines={1}>{activeTrack.artist}</Text>
        </View>
        <MessageSquare color={palette.primary + '88'} size={20} />
      </View>

      {/* Synced Lyrics List with word-level highlight */}
      <View style={{ flex: 1 }}>
        <SyncedLyricsList
          lyrics={lyrics}
          activeIndex={currentLyricLineIndex}
          currentPositionMs={progress.position * 1000}
          onLinePress={handleLinePress}
          onScrollBeginDrag={activateLock}
          isLocked={isLocked}
          accentColor={palette.primary}
        />
      </View>

      {/* Genius Expandable Annotation Bottom Panel */}
      {activeFragment && (
        <Animated.View style={[styles.annotationSheet, { backgroundColor: palette.backgroundTint, borderColor: palette.primary + '30' }, animatedSheetStyle]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: palette.primary }]}>GENIUS LYRIC FACT</Text>
            <Pressable onPress={handleCloseAnnotations} style={styles.closeSheet}>
              <X color={palette.primary} size={18} />
            </Pressable>
          </View>
          <Text style={[styles.annotationQuote, { color: palette.secondary }]}>
            "{activeFragment}"
          </Text>
          <Text style={[styles.annotationBody, { color: 'rgba(255,255,255,0.8)' }]}>
            {activeCommentary}
          </Text>
        </Animated.View>
      )}

      {/* Footer hint */}
      <View style={[styles.footer, { borderColor: palette.primary + '20' }]}>
        <Text style={[styles.footerHint, { color: palette.primary + 'AA' }]}>
          {activeFragment ? 'TAP THE “X” TO CLOSE FACTS' : 'TAP ANY LINE TO JUMP & VIEW FACTS'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  glowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.08,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingBottom: 16,
    borderBottomWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  backButton: {
    padding: 6,
  },
  headerDetails: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 16,
  },
  songTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.base,
  },
  artistName: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    marginTop: 2,
  },
  annotationSheet: {
    position: 'absolute',
    bottom: 60,
    left: 20,
    right: 20,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
    gap: 8,
    zIndex: 9999,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#E040FB', // Ultra violet highlights
  },
  closeSheet: {
    padding: 4,
  },
  annotationQuote: {
    fontFamily: Typography.fonts.display,
    fontStyle: 'italic',
    fontSize: Typography.sizes.sm,
  },
  annotationBody: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.sm,
    lineHeight: 18,
  },
  footer: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
  },
  footerHint: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1.5,
  },
});

