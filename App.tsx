import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { useFonts, DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TrackPlayer, { Capability } from 'react-native-track-player';

import { PantoneColors, Theme } from './src/theme/colors';
import { AppNavigator } from './src/navigation/AppNavigator';
import { usePlaybackStore } from './src/stores/usePlaybackStore';

export default function App() {
  // Preload custom Pantone Typography fonts
  const [fontsLoaded] = useFonts({
    DMSerifDisplay_400Regular,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  const [playerReady, setPlayerReady] = useState(false);
  const initializeStore = usePlaybackStore((state) => state.initializeStore);

  useEffect(() => {
    async function setupPlayer() {
      try {
        // Initialize react-native-track-player options
        // setupPlayer throws if already initialized (e.g. HMR) — that's fine
        await TrackPlayer.setupPlayer({});
      } catch (err: any) {
        // "already been initialized" is not a real error
        if (!err?.message?.includes('already')) {
          console.warn('[App] TrackPlayer.setupPlayer error:', err);
        }
      }

      try {
        await TrackPlayer.updateOptions({
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
          ],
          compactCapabilities: [
            Capability.Play,
            Capability.Pause,
          ],
        });
      } catch (err) {
        console.warn('[App] TrackPlayer.updateOptions error:', err);
      }

      try {
        // Initialize Zustand playback store listeners
        await initializeStore();
      } catch (err) {
        console.warn('[App] initializeStore error:', err);
      }

      // Always unblock the UI — a degraded app is better than an infinite spinner
      setPlayerReady(true);
    }
    setupPlayer();
  }, [initializeStore]);

  if (!fontsLoaded || !playerReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={PantoneColors.mediumSlate} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppNavigator />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Theme.dark.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

