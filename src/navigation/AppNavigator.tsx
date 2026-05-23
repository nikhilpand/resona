import React, { useState } from 'react';
import { StyleSheet, View, Text, Pressable, Image, Modal, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { Home as HomeIcon, Search as SearchIcon, Library as LibraryIcon, Download as DownloadIcon, Play, Pause, ChevronUp, X, Settings as SettingsIcon } from 'lucide-react-native';

import { HomeScreen } from '../screens/HomeScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { DownloadsScreen } from '../screens/DownloadsScreen';
import { NowPlayingScreen } from '../screens/NowPlayingScreen';
import { LyricsScreen } from '../screens/LyricsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

import { Theme, PantoneColors } from '../theme/colors';
import { Typography } from '../theme/typography';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeStore } from '../stores/useThemeStore';
import TrackPlayer, { State } from 'react-native-track-player';

const Tab = createBottomTabNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Theme.dark.surface,
          borderTopWidth: 1,
          borderTopColor: Theme.dark.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: PantoneColors.mediumSlate,
        tabBarInactiveTintColor: Theme.dark.textMuted,
        tabBarLabelStyle: {
          fontFamily: Typography.fonts.bodyMedium,
          fontSize: 10,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, size }) => <HomeIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          tabBarLabel: 'Search',
          tabBarIcon: ({ color, size }) => <SearchIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{
          tabBarLabel: 'Library',
          tabBarIcon: ({ color, size }) => <LibraryIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Downloads"
        component={DownloadsScreen}
        options={{
          tabBarLabel: 'Downloads',
          tabBarIcon: ({ color, size }) => <DownloadIcon color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  // Playback state binds
  const activeTrack = usePlaybackStore((state) => state.activeTrack);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const togglePlay = usePlaybackStore((state) => state.togglePlay);

  // Per-song palette for mini-player theming
  const palette = useThemeStore((s) => s.palette);

  // Layout presentation states
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Reanimated transition shared values
  const translateY = useSharedValue(screenHeight);

  const isPlaying = playbackState === State.Playing;

  const handleExpandPlayer = () => {
    translateY.value = withSpring(0, { damping: 15 });
    setPlayerExpanded(true);
  };

  const handleCollapsePlayer = () => {
    translateY.value = withSpring(screenHeight, { damping: 15 });
    setPlayerExpanded(false);
    setShowLyrics(false);
  };

  const animatedPlayerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <NavigationContainer>
      <View style={{ flex: 1, backgroundColor: Theme.dark.background }}>
        {/* Navigation Core */}
        <TabNavigator />

        {/* Global Floating Mini Player (visible when track is loaded and player not expanded) */}
        {activeTrack && !playerExpanded && (
          <Pressable
            style={[
              styles.miniPlayer,
              { borderColor: palette.primary + '50', bottom: 64 + insets.bottom + 8 }
            ]}
            onPress={handleExpandPlayer}
          >
            <Image source={{ uri: activeTrack.artwork || 'https://picsum.photos/100/100' }} style={styles.miniArtwork} />
            <View style={styles.miniDetails}>
              <Text style={styles.miniTitle} numberOfLines={1}>{activeTrack.title}</Text>
              <Text style={[styles.miniArtist, { color: palette.primary }]} numberOfLines={1}>{activeTrack.artist}</Text>
            </View>
            <Pressable style={styles.miniControl} onPress={togglePlay}>
              {isPlaying
                ? <Pause color={palette.primary} size={20} fill={palette.primary} />
                : <Play color={palette.primary} size={20} fill={palette.primary} />
              }
            </Pressable>
          </Pressable>
        )}

        {/* Immersive Slide-up Player Sheet Container */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.modalContainer, animatedPlayerStyle]}>
          {/* Header handle to drag down or collapse */}
          <View style={[styles.dragHandleContainer, { paddingTop: insets.top }]}>
            <Pressable style={styles.dragButton} onPress={handleCollapsePlayer}>
              <ChevronUp color={Theme.dark.textMuted} size={24} style={styles.collapseArrow} />
            </Pressable>
          </View>

          {/* Render Now Playing or Lyrics depending on state toggle */}
          {showLyrics ? (
            <LyricsScreen onBack={() => setShowLyrics(false)} />
          ) : (
            <NowPlayingScreen onToggleLyrics={() => setShowLyrics(true)} />
          )}
        </Animated.View>

        {/* Settings Gear Icon (floating top-right) */}
        <Pressable
          style={[styles.settingsButton, { top: insets.top + 8 }]}
          onPress={() => setShowSettings(true)}
        >
          <SettingsIcon color={PantoneColors.paleViolet} size={20} />
        </Pressable>

        {/* Settings Modal */}
        <Modal
          visible={showSettings}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setShowSettings(false)}
        >
          <SettingsScreen onClose={() => setShowSettings(false)} />
        </Modal>
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  miniPlayer: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,26,38,0.92)', // Semi-transparent Navy
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(123,104,238,0.3)',
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  miniArtwork: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: PantoneColors.obsidian,
  },
  miniDetails: {
    flex: 1,
    marginLeft: 12,
  },
  miniTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.sm,
    color: Theme.dark.text,
  },
  miniArtist: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: PantoneColors.crystalBlue,
    marginTop: 2,
  },
  miniControl: {
    padding: 8,
    marginRight: 4,
  },
  modalContainer: {
    backgroundColor: Theme.dark.background,
    zIndex: 999,
  },
  dragHandleContainer: {
    alignItems: 'center',
    backgroundColor: Theme.dark.background,
  },
  dragButton: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  collapseArrow: {
    transform: [{ rotate: '180deg' }],
  },
  settingsButton: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
});
