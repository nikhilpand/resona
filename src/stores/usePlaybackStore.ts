import { create } from 'zustand';
import TrackPlayer, { State, Track, Event } from 'react-native-track-player';
import { ResolvingDataSource } from '../services/youtube/ResolvingDataSource';

/** Interval (ms) between progress sync ticks */
const PROGRESS_SYNC_INTERVAL_MS = 1000;

let _initialized = false;
let _progressInterval: ReturnType<typeof setInterval> | null = null;

interface PlaybackState {
  // Queue & Track states
  queue: Track[];
  activeTrack: Track | null;
  playbackState: State;
  playbackPosition: number;
  playbackDuration: number;
  
  // Custom Visualizer & Lyrics state
  visualizerBass: number;
  visualizerMid: number;
  visualizerTreble: number;
  currentLyricLineIndex: number;
  
  // Actions
  initializeStore: () => Promise<void>;
  setQueue: (tracks: Track[]) => Promise<void>;
  addTrack: (track: Track) => Promise<void>;
  playTrack: (trackIndex: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  updateProgress: (position: number, duration: number) => void;
  updateVisualizer: (bass: number, mid: number, treble: number) => void;
  setLyricIndex: (index: number) => void;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  queue: [],
  activeTrack: null,
  playbackState: State.None,
  playbackPosition: 0,
  playbackDuration: 0,
  visualizerBass: 0,
  visualizerMid: 0,
  visualizerTreble: 0,
  currentLyricLineIndex: -1,

  initializeStore: async () => {
    // Prevent double-initialization (React StrictMode, HMR, etc.)
    if (_initialized) return;
    _initialized = true;

    // Listen to native Track Player state updates
    TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
      set({ playbackState: event.state });
    });

    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
      set({ 
        activeTrack: event.track || null,
        currentLyricLineIndex: -1 
      });
    });

    // Clear any previous interval (safety for HMR)
    if (_progressInterval) {
      clearInterval(_progressInterval);
    }

    // Background interval to sync progress & trigger pre-resolution
    _progressInterval = setInterval(async () => {
      try {
        const stateObj = await TrackPlayer.getPlaybackState();
        if (stateObj.state === State.Playing) {
          const position = await TrackPlayer.getPosition();
          const duration = await TrackPlayer.getDuration();
          if (duration > 0) {
            set({ playbackPosition: position, playbackDuration: duration });
            await ResolvingDataSource.handleProgress(position, duration);
          }
        }
      } catch (_) {
        // Silent catch — TrackPlayer may not be initialized yet
      }
    }, PROGRESS_SYNC_INTERVAL_MS);
  },

  setQueue: async (tracks) => {
    // Copy the array to avoid modifying parameters directly
    const queueTracks = [...tracks];

    // Synchronously resolve the first track's URL if present
    if (queueTracks.length > 0) {
      const first = queueTracks[0];
      try {
        const resolvedUrl = await ResolvingDataSource.resolveTrack(first);
        queueTracks[0] = { ...first, url: resolvedUrl };
      } catch (err) {
        console.warn('[PlaybackStore] Failed to resolve first track URL:', err);
      }
    }

    await TrackPlayer.setQueue(queueTracks);
    set({ queue: queueTracks });
    ResolvingDataSource.clearTracking();

    // Asynchronously pre-resolve the second track
    if (queueTracks.length > 1) {
      const second = queueTracks[1];
      ResolvingDataSource.resolveTrack(second)
        .then(async (resolvedUrl) => {
          try {
            const currentQueue = await TrackPlayer.getQueue();
            if (currentQueue.length > 1 && currentQueue[1].id === second.id) {
              await TrackPlayer.add({ ...second, url: resolvedUrl }, 1);
              await TrackPlayer.remove(2);
            }
          } catch (e) {
            console.warn('[PlaybackStore] Pre-resolve queue replacement failed:', e);
          }
        })
        .catch((err) => {
          console.warn('[PlaybackStore] Async pre-resolve second track failed:', err);
        });
    }
  },

  addTrack: async (track) => {
    const queue = get().queue;
    let trackToInsert = track;

    // Resolve URL first if queue is empty (since it will start playing soon)
    if (queue.length === 0) {
      try {
        const resolvedUrl = await ResolvingDataSource.resolveTrack(track);
        trackToInsert = { ...track, url: resolvedUrl };
      } catch (err) {
        console.warn('[PlaybackStore] Failed to resolve added track URL:', err);
      }
    }

    await TrackPlayer.add(trackToInsert);
    const updatedQueue = await TrackPlayer.getQueue();
    set({ queue: updatedQueue });
  },

  playTrack: async (trackIndex) => {
    const queue = get().queue;
    if (trackIndex >= 0 && trackIndex < queue.length) {
      const track = queue[trackIndex];
      try {
        const resolvedUrl = await ResolvingDataSource.resolveTrack(track);
        
        const updatedTrack = { ...track, url: resolvedUrl };

        // Update local queue representation
        const updatedQueue = [...queue];
        updatedQueue[trackIndex] = updatedTrack;
        set({ queue: updatedQueue });

        // Update player queue by inserting new resolved track and removing old
        const currentQueue = await TrackPlayer.getQueue();
        if (trackIndex < currentQueue.length) {
          await TrackPlayer.add(updatedTrack, trackIndex);
          await TrackPlayer.remove(trackIndex + 1);
        }
      } catch (err) {
        console.warn('[PlaybackStore] Failed to resolve play track URL:', err);
      }
    }
    await TrackPlayer.skip(trackIndex);
    await TrackPlayer.play();
  },

  togglePlay: async () => {
    const state = get().playbackState;
    if (state === State.Playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  },

  updateProgress: (position, duration) => {
    set({ playbackPosition: position, playbackDuration: duration });
  },

  updateVisualizer: (bass, mid, treble) => {
    set({ visualizerBass: bass, visualizerMid: mid, visualizerTreble: treble });
  },

  setLyricIndex: (index) => {
    set({ currentLyricLineIndex: index });
  }
}));

