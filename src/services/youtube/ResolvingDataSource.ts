import TrackPlayer, { Track } from 'react-native-track-player';
import { db } from '../../db/client';
import {
  BACKEND_BASE_URL,
  BACKEND_API_KEY,
  STREAM_URL_EXPIRY_BUFFER_MS,
} from '../../config';

const RESOLVE_API_URL = `${BACKEND_BASE_URL}/api/resolve`;

export class ResolvingDataSource {
  private static preResolvingMap = new Set<string>();

  /**
   * Resolves a streaming URL for a given track.
   * Checks database cache first, and queries backend Fastify proxy if expired.
   */
  public static async resolveTrack(track: Track): Promise<string> {
    const videoId = track.id;

    // 1. Check local SQLite DB
    try {
      const rows = await db.execute(
        'SELECT streamUrl, urlExpiry FROM tracks WHERE id = ?',
        [videoId]
      );

      if (rows.length > 0) {
        const { streamUrl, urlExpiry } = rows[0];
        // Check if stream URL is present and not within 5 minutes of expiring
        if (streamUrl && urlExpiry && Date.now() < Number(urlExpiry) - STREAM_URL_EXPIRY_BUFFER_MS) {
          console.log(`[ResolvingDataSource] Using cached URL for track ${videoId}`);
          return streamUrl;
        }
      }
    } catch (err) {
      console.warn('[ResolvingDataSource] SQLite cache query error:', err);
    }

    // 2. Fetch fresh URL from Fastify proxy
    console.log(`[ResolvingDataSource] Cache miss or expired. Fetching stream from proxy for track ${videoId}...`);
    try {
      const response = await fetch(RESOLVE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': BACKEND_API_KEY,
        },
        body: JSON.stringify({ videoId }),
      });

      if (!response.ok) {
        throw new Error(`Proxy resolution failed: ${response.statusText}`);
      }

      const data = await response.json();
      const freshUrl = data.url;
      const expiresIn = data.expiresIn || 6 * 60 * 60; // default 6 hours
      const newExpiry = Date.now() + expiresIn * 1000;

      if (!freshUrl) {
        throw new Error('Proxy returned empty stream URL');
      }

      // 3. Update/Insert SQLite cache
      try {
        await db.run(
          `INSERT INTO tracks (id, title, artist, album, artwork, duration, streamUrl, urlExpiry)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             streamUrl = excluded.streamUrl,
             urlExpiry = excluded.urlExpiry`,
          [
            videoId,
            track.title || 'Unknown Title',
            track.artist || 'Unknown Artist',
            track.album || '',
            track.artwork || '',
            track.duration || 0,
            freshUrl,
            newExpiry,
          ]
        );
        console.log(`[ResolvingDataSource] Cached resolved stream URL for track ${videoId}`);
      } catch (dbErr) {
        console.warn('[ResolvingDataSource] SQLite cache update failed:', dbErr);
      }

      return freshUrl;
    } catch (error) {
      console.error('[ResolvingDataSource] Proxy resolution error:', error);
      // Fallback to existing URL if present
      return track.url || '';
    }
  }

  /**
   * Listens to player position progress.
   * Proactively pre-resolves the next track URL in the queue if current progress passes 80%.
   */
  public static async handleProgress(position: number, duration: number): Promise<void> {
    if (duration <= 0) return;

    const progressPercent = position / duration;
    if (progressPercent >= 0.8) {
      try {
        const queue = await TrackPlayer.getQueue();
        const activeIndex = await TrackPlayer.getActiveTrackIndex();

        if (activeIndex !== undefined && activeIndex !== null && activeIndex < queue.length - 1) {
          const nextTrack = queue[activeIndex + 1];
          
          if (this.preResolvingMap.has(nextTrack.id)) {
            return; // Already pre-resolving or pre-resolved
          }

          this.preResolvingMap.add(nextTrack.id);
          console.log(`[ResolvingDataSource] Look-ahead triggered (progress: ${Math.round(progressPercent * 100)}%). Pre-resolving next track: ${nextTrack.title}`);

          const resolvedUrl = await this.resolveTrack(nextTrack);

          // Update queue item by inserting the new one and removing the old one
          const targetIndex = activeIndex + 1;
          await TrackPlayer.add({ ...nextTrack, url: resolvedUrl }, targetIndex);
          await TrackPlayer.remove(targetIndex + 1);

          console.log(`[ResolvingDataSource] Pre-resolved next track URL saved in queue.`);
        }
      } catch (err) {
        console.warn('[ResolvingDataSource] Pre-resolution loop failed:', err);
      }
    }
  }

  /**
   * Resets pre-resolving trackers (e.g. when changing queues)
   */
  public static clearTracking() {
    this.preResolvingMap.clear();
  }
}
