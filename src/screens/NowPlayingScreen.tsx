import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  Pressable,
  useWindowDimensions,
  Alert,
} from 'react-native';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ListMusic,
  AlignLeft,
  Volume2,
  Shuffle,
  Repeat,
  Moon,
} from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  withSequence,
  Easing,
  cancelAnimation,
  useDerivedValue,
  interpolate,
  useAnimatedReaction,
} from 'react-native-reanimated';
import { Theme, PantoneColors } from '../theme/colors';
import { Typography } from '../theme/typography';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeStore } from '../stores/useThemeStore';
import { useSleepTimerStore } from '../stores/useSleepTimerStore';
import { AudioVisualizer } from '../components/player/AudioVisualizer';
import TrackPlayer, { State, useProgress } from 'react-native-track-player';

interface NowPlayingScreenProps {
  onToggleLyrics: () => void;
}

export const NowPlayingScreen: React.FC<NowPlayingScreenProps> = ({ onToggleLyrics }) => {
  const { width } = useWindowDimensions();
  const progress = useProgress(250);

  const activeTrack = usePlaybackStore((s) => s.activeTrack);
  const playbackState = usePlaybackStore((s) => s.playbackState);
  const togglePlay = usePlaybackStore((s) => s.togglePlay);

  // Per-song palette from theme store
  const palette = useThemeStore((s) => s.palette);
  const updatePalette = useThemeStore((s) => s.updatePalette);

  // Sleep timer
  const sleepTimerRemaining = useSleepTimerStore((s) => s.remainingSeconds);
  const showSleepTimerPicker = useSleepTimerStore((s) => s.showPicker);

  const [mockFrequencies, setMockFrequencies] = useState<number[]>(new Array(30).fill(0.05));

  const isPlaying = playbackState === State.Playing;

  // ── Vinyl Spin Animation ─────────────────────────────────────────────────────
  /** Tracks cumulative rotation in degrees (persisted across pause/resume) */
  const rotation = useSharedValue(0);
  /** Whether the disc is currently spinning */
  const isSpinning = useSharedValue(false);

  useEffect(() => {
    if (isPlaying) {
      isSpinning.value = true;
      // Continuous 360° rotation at 33 RPM (one revolution every ~1818ms)
      rotation.value = withRepeat(
        withTiming(rotation.value + 360, {
          duration: 7000, // Full rotation in 7s (casual album speed)
          easing: Easing.linear,
        }),
        -1, // Infinite
        false
      );
    } else {
      isSpinning.value = false;
      cancelAnimation(rotation);
      // Gentle spring-back to nearest 0° snap point
      const nearestAngle = Math.round(rotation.value / 360) * 360;
      rotation.value = withSpring(nearestAngle, { damping: 20, stiffness: 60 });
    }
  }, [isPlaying]);

  const vinylAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // Scale artwork down slightly when paused (record "dropping off" effect)
  const artworkScale = useSharedValue(1);
  useEffect(() => {
    artworkScale.value = withSpring(isPlaying ? 1 : 0.94, { damping: 12 });
  }, [isPlaying]);

  const artworkScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: artworkScale.value }],
  }));

  // ── Palette Update on Track Change ───────────────────────────────────────────
  useEffect(() => {
    if (activeTrack) {
      updatePalette(activeTrack.id, activeTrack.artwork as string | undefined);
    }
  }, [activeTrack?.id]);

  // ── FFT Visualizer Mock ──────────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isPlaying) {
      const update = () => {
        setMockFrequencies(Array.from({ length: 30 }, () => Math.random() * 0.95 + 0.05));
        timer = setTimeout(update, 100);
      };
      update();
    } else {
      setMockFrequencies(new Array(30).fill(0.05));
    }
    return () => clearTimeout(timer);
  }, [isPlaying]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleNext = async () => {
    try { await TrackPlayer.skipToNext(); } catch { /* end of queue */ }
  };

  const handlePrevious = async () => {
    try { await TrackPlayer.skipToPrevious(); } catch { /* start of queue */ }
  };

  if (!activeTrack) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No Active Playback</Text>
        <Text style={styles.emptySubText}>Select a track to begin.</Text>
      </View>
    );
  }

  const progressPercentage = progress.duration > 0
    ? (progress.position / progress.duration) * 100
    : 0;

  const ARTWORK_SIZE = Math.min(width - 80, 280);

  return (
    <View style={[styles.container, { backgroundColor: palette.backgroundTint }]}>
      {/* Per-Song Ambient Glow Blobs — colored by album palette */}
      <View style={[styles.glowBlob1, { backgroundColor: palette.primary + '20' }]} />
      <View style={[styles.glowBlob2, { backgroundColor: palette.secondary + '18' }]} />

      {/* Header */}
      <View style={styles.header}>
        <ListMusic color={palette.primary + 'AA'} size={22} />
        <Text style={[styles.nowPlayingTitle, { color: palette.primary + 'BB' }]}>NOW PLAYING</Text>
        <Pressable onPress={onToggleLyrics}>
          <AlignLeft color={palette.primary} size={22} />
        </Pressable>
      </View>

      {/* ── Vinyl Disc + Artwork ─────────────────────────────────────────── */}
      <View style={[styles.vinylContainer, { width: ARTWORK_SIZE + 24, height: ARTWORK_SIZE + 24 }]}>
        {/* Outer vinyl ring — rotates with disc */}
        <Animated.View style={[styles.vinylRing, { width: ARTWORK_SIZE + 24, height: ARTWORK_SIZE + 24, borderRadius: (ARTWORK_SIZE + 24) / 2, borderColor: palette.primary + '30' }, vinylAnimatedStyle]}>
          {/* Vinyl grooves */}
          <View style={[styles.vinylGroove, { width: ARTWORK_SIZE - 20, height: ARTWORK_SIZE - 20, borderRadius: (ARTWORK_SIZE - 20) / 2, borderColor: palette.primary + '12' }]} />
          <View style={[styles.vinylGroove, { width: ARTWORK_SIZE - 50, height: ARTWORK_SIZE - 50, borderRadius: (ARTWORK_SIZE - 50) / 2, borderColor: palette.primary + '10' }]} />
        </Animated.View>

        {/* Album artwork — center circle of disc, scales on pause */}
        <Animated.View
          style={[
            styles.artworkWrapper,
            {
              width: ARTWORK_SIZE,
              height: ARTWORK_SIZE,
              borderRadius: ARTWORK_SIZE / 2,
              shadowColor: palette.artworkShadow,
            },
            artworkScaleStyle,
          ]}
        >
          <Animated.Image
            source={{ uri: activeTrack.artwork || 'https://picsum.photos/400/400' }}
            style={[styles.artwork, { width: ARTWORK_SIZE, height: ARTWORK_SIZE, borderRadius: ARTWORK_SIZE / 2 }]}
          />
          {/* Center spindle dot */}
          <View style={[styles.spindleDot, { backgroundColor: palette.primary }]} />
        </Animated.View>
      </View>

      {/* Info Block */}
      <View style={styles.infoBlock}>
        <Text style={[styles.songTitle, { textShadowColor: palette.textGlow }]} numberOfLines={1}>
          {activeTrack.title}
        </Text>
        <Text style={[styles.artistName, { color: palette.primary }]} numberOfLines={1}>
          {activeTrack.artist}
        </Text>
      </View>

      {/* Skia Audio Visualizer — tinted with song palette */}
      <View style={styles.visualizerContainer}>
        <AudioVisualizer frequencies={mockFrequencies} color={palette.primary} />
      </View>

      {/* Progress Bar — colored with palette primary */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercentage}%`, backgroundColor: palette.primary }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
          <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controlsContainer}>
        <Pressable style={styles.sideButton}>
          <Shuffle color={palette.primary + '66'} size={20} />
        </Pressable>

        <Pressable style={styles.prevButton} onPress={handlePrevious}>
          <SkipBack color={palette.primary} size={28} fill={palette.primary} />
        </Pressable>

        <Pressable
          style={[styles.playPauseButton, { backgroundColor: palette.primary }]}
          onPress={togglePlay}
        >
          {isPlaying
            ? <Pause color="#000" size={28} fill="#000" />
            : <Play color="#000" size={28} fill="#000" style={{ marginLeft: 3 }} />
          }
        </Pressable>

        <Pressable style={styles.nextButton} onPress={handleNext}>
          <SkipForward color={palette.primary} size={28} fill={palette.primary} />
        </Pressable>

        <Pressable style={styles.sideButton}>
          <Repeat color={palette.primary + '66'} size={20} />
        </Pressable>
      </View>

      {/* Utility Footer — volume + sleep timer */}
      <View style={styles.utilityFooter}>
        <Volume2 color={palette.primary + '88'} size={16} />
        <View style={styles.mockVolumeBar}>
          <View style={[styles.mockVolumeFill, { backgroundColor: palette.primary + 'AA' }]} />
        </View>

        <Pressable onPress={showSleepTimerPicker} style={styles.sleepTimerButton}>
          <Moon
            color={sleepTimerRemaining > 0 ? palette.primary : palette.primary + '55'}
            size={16}
            fill={sleepTimerRemaining > 0 ? palette.primary : 'transparent'}
          />
          {sleepTimerRemaining > 0 && (
            <Text style={[styles.sleepTimerBadge, { color: palette.primary }]}>
              {Math.ceil(sleepTimerRemaining / 60)}m
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: Theme.dark.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.xl,
    color: Theme.dark.text,
    marginBottom: 8,
  },
  emptySubText: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.sm,
    color: Theme.dark.textMuted,
    textAlign: 'center',
  },
  // ── Glow blobs
  glowBlob1: {
    position: 'absolute',
    top: 80,
    left: -60,
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  glowBlob2: {
    position: 'absolute',
    bottom: 180,
    right: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  nowPlayingTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.xs,
    letterSpacing: 2,
  },
  // ── Vinyl
  vinylContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  vinylRing: {
    position: 'absolute',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylGroove: {
    position: 'absolute',
    borderWidth: 1,
  },
  artworkWrapper: {
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 28,
    elevation: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artwork: {
    backgroundColor: PantoneColors.obsidian,
  },
  spindleDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    opacity: 0.8,
  },
  // ── Info
  infoBlock: {
    alignItems: 'center',
    width: '100%',
    marginVertical: 8,
  },
  songTitle: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.xl,
    color: '#ffffff',
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  artistName: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: Typography.sizes.base,
    marginTop: 6,
    textAlign: 'center',
  },
  // ── Visualizer
  visualizerContainer: {
    width: '100%',
    height: 80,
    justifyContent: 'center',
    marginVertical: 6,
  },
  // ── Progress
  progressContainer: {
    width: '100%',
    marginVertical: 8,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  timeText: {
    fontFamily: Typography.fonts.monospace,
    fontSize: Typography.sizes.xs,
    color: 'rgba(255,255,255,0.4)',
  },
  // ── Controls
  controlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginVertical: 8,
  },
  sideButton: { padding: 8 },
  prevButton: { padding: 8 },
  nextButton: { padding: 8 },
  playPauseButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  // ── Footer
  utilityFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '90%',
    justifyContent: 'center',
  },
  mockVolumeBar: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 1.5,
    maxWidth: 120,
  },
  mockVolumeFill: {
    width: '75%',
    height: '100%',
    borderRadius: 1.5,
  },
  sleepTimerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
  },
  sleepTimerBadge: {
    fontFamily: Typography.fonts.monospace,
    fontSize: 10,
    fontWeight: '700',
  },
});
