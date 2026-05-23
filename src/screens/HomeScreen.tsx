import React, { useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, Image } from 'react-native';
import { Play, Flame, Disc, History, Music } from 'lucide-react-native';
import { Theme, PantoneColors } from '../theme/colors';
import { Typography } from '../theme/typography';
import { usePlaybackStore } from '../stores/usePlaybackStore';

// Mock recommended tracks matching high-end design
const MOCK_RECOMMENDED = [
  { id: '1', title: 'Starlight', artist: 'Muse', album: 'Black Holes & Revelations', artwork: 'https://picsum.photos/200/200?random=1', duration: 240 },
  { id: '2', title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We\'re Dreaming', artwork: 'https://picsum.photos/200/200?random=2', duration: 243 },
  { id: '3', title: 'Pulsar', artist: 'Gemini', album: 'Ambient Wave Synth', artwork: 'https://picsum.photos/200/200?random=3', duration: 180 },
];

export const HomeScreen: React.FC = () => {
  const setQueue = usePlaybackStore((state) => state.setQueue);
  const playTrack = usePlaybackStore((state) => state.playTrack);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return 'Good Night';
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const handlePlayRecommended = async (track: typeof MOCK_RECOMMENDED[0]) => {
    const playTrackPayload = {
      id: track.id,
      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', // Stable placeholder audio
      title: track.title,
      artist: track.artist,
      artwork: track.artwork,
      duration: track.duration,
    };
    await setQueue([playTrackPayload]);
    await playTrack(0);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Immersive Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting}</Text>
        <Text style={styles.subGreeting}>YOUR PERSONAL SOUND SHELL</Text>
      </View>

      {/* Row of quick selectors */}
      <View style={styles.quickSelectGrid}>
        <Pressable style={styles.quickCard}>
          <Flame color={PantoneColors.ultraViolet} size={20} />
          <Text style={styles.quickCardText}>Mood Mixes</Text>
        </Pressable>
        <Pressable style={styles.quickCard}>
          <History color={PantoneColors.crystalBlue} size={20} />
          <Text style={styles.quickCardText}>Recent Tracks</Text>
        </Pressable>
      </View>

      {/* Featured Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Disc color={PantoneColors.mediumSlate} size={18} />
          <Text style={styles.sectionTitle}>Featured Pulse</Text>
        </View>
        
        {MOCK_RECOMMENDED.map((track) => (
          <Pressable 
            key={track.id} 
            style={styles.trackRow} 
            onPress={() => handlePlayRecommended(track)}
          >
            <Image source={{ uri: track.artwork }} style={styles.trackArtwork} />
            <View style={styles.trackDetails}>
              <Text style={styles.trackTitle}>{track.title}</Text>
              <Text style={styles.trackArtist}>{track.artist} • {track.album}</Text>
            </View>
            <View style={styles.playButtonWrapper}>
              <Play color={Theme.dark.text} size={14} fill={Theme.dark.text} />
            </View>
          </Pressable>
        ))}
      </View>

      {/* Aesthetic card */}
      <View style={styles.visualizerBanner}>
        <View style={styles.bannerTextContainer}>
          <Music color={PantoneColors.paleViolet} size={24} />
          <Text style={styles.bannerTitle}>Gemini Visualizer</Text>
          <Text style={styles.bannerDesc}>Watch colors respond to live audio frequencies in Now Playing.</Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.dark.background,
  },
  content: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 100,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.xxl,
    color: Theme.dark.text,
  },
  subGreeting: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.xs,
    color: Theme.dark.textMuted,
    letterSpacing: 2,
    marginTop: 4,
  },
  quickSelectGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  quickCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Theme.dark.surface,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.dark.border,
  },
  quickCardText: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: Typography.sizes.sm,
    color: Theme.dark.text,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.sm,
    color: Theme.dark.textMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.dark.surface,
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Theme.dark.border,
  },
  trackArtwork: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: PantoneColors.obsidian,
  },
  trackDetails: {
    flex: 1,
    marginLeft: 14,
  },
  trackTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.base,
    color: Theme.dark.text,
  },
  trackArtist: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: Theme.dark.textMuted,
    marginTop: 2,
  },
  playButtonWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PantoneColors.mediumSlate + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualizerBanner: {
    backgroundColor: PantoneColors.deepNavy,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: PantoneColors.mediumSlate + '40',
    position: 'relative',
    overflow: 'hidden',
  },
  bannerTextContainer: {
    gap: 6,
  },
  bannerTitle: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.lg,
    color: Theme.dark.text,
    marginTop: 6,
  },
  bannerDesc: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.sm,
    color: Theme.dark.textMuted,
    lineHeight: 18,
  },
});
