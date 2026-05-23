import { create } from 'zustand';
import { Alert } from 'react-native';
import TrackPlayer, { State } from 'react-native-track-player';

/** Available sleep timer presets in minutes (0 = off) */
export const SLEEP_TIMER_PRESETS = [5, 10, 15, 20, 30, 45, 60] as const;

interface SleepTimerState {
  /** Remaining seconds until playback fades/stops. 0 = not active. */
  remainingSeconds: number;
  /** Whether a timer is currently active */
  isActive: boolean;

  /** Call from NowPlayingScreen to show the picker dialog */
  showPicker: () => void;
  /** Start the timer for N minutes */
  startTimer: (minutes: number) => void;
  /** Cancel any active timer */
  cancelTimer: () => void;
  /** Internal tick — called every second by the active interval */
  _tick: () => Promise<void>;
}

let _sleepInterval: ReturnType<typeof setInterval> | null = null;

export const useSleepTimerStore = create<SleepTimerState>((set, get) => ({
  remainingSeconds: 0,
  isActive: false,

  showPicker: () => {
    const { isActive, cancelTimer, startTimer, remainingSeconds } = get();

    const cancelOption = isActive
      ? [{
          text: `Cancel Timer (${Math.ceil(remainingSeconds / 60)}m left)`,
          style: 'destructive' as const,
          onPress: cancelTimer,
        }]
      : [];

    Alert.alert(
      'Sleep Timer',
      'Music will fade out and stop after the selected time.',
      [
        ...cancelOption,
        ...SLEEP_TIMER_PRESETS.map((mins) => ({
          text: `${mins} minutes`,
          onPress: () => startTimer(mins),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  },

  startTimer: (minutes: number) => {
    // Clear any existing timer first
    if (_sleepInterval) {
      clearInterval(_sleepInterval);
      _sleepInterval = null;
    }

    const totalSeconds = minutes * 60;
    set({ remainingSeconds: totalSeconds, isActive: true });

    _sleepInterval = setInterval(() => {
      get()._tick();
    }, 1000);
  },

  cancelTimer: () => {
    if (_sleepInterval) {
      clearInterval(_sleepInterval);
      _sleepInterval = null;
    }
    set({ remainingSeconds: 0, isActive: false });
  },

  _tick: async () => {
    const { remainingSeconds, cancelTimer } = get();

    // Safety: check if music is actually playing before counting down
    try {
      const stateObj = await TrackPlayer.getPlaybackState();
      if (stateObj.state !== State.Playing) {
        // Music not playing — pause the countdown but keep timer alive
        return;
      }
    } catch {
      return; // TrackPlayer not ready
    }

    const next = remainingSeconds - 1;

    if (next <= 0) {
      // Time's up — fade out volume over 4 seconds then pause
      set({ remainingSeconds: 0, isActive: false });
      if (_sleepInterval) {
        clearInterval(_sleepInterval);
        _sleepInterval = null;
      }
      await fadeOutAndStop();
      return;
    }

    // In the last 30 seconds — gradually reduce volume
    if (next <= 30) {
      const volumeLevel = next / 30; // 1.0 → 0.0 over 30s
      try {
        await TrackPlayer.setVolume(Math.max(volumeLevel, 0));
      } catch { /* silent */ }
    }

    set({ remainingSeconds: next });
  },
}));

/** Fades volume from current level to 0 over 4s, then pauses. */
async function fadeOutAndStop() {
  const STEPS = 20;
  const INTERVAL = 200; // ms between steps → 4s total

  for (let i = STEPS; i >= 0; i--) {
    try {
      await TrackPlayer.setVolume(i / STEPS);
    } catch { break; }
    await new Promise<void>((r) => setTimeout(r, INTERVAL));
  }

  try {
    await TrackPlayer.pause();
    // Restore volume for next play session
    await new Promise<void>((r) => setTimeout(r, 500));
    await TrackPlayer.setVolume(1);
  } catch { /* silent */ }
}
