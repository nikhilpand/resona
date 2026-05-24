import { create } from 'zustand';
import { db } from '../db/client';
import { BACKEND_BASE_URL, BACKEND_API_KEY, DownloadQuality } from '../config';
import { LyricsClient } from '../services/lyrics/LyricsClient';
import * as FileSystem from 'expo-file-system/legacy';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DownloadItem {
  trackId: string;
  title: string;
  artist: string;
  quality: DownloadQuality;
  status: 'pending' | 'downloading' | 'transcoding' | 'complete' | 'failed';
  progress: number; // 0.0 – 1.0
  filePath: string | null;
  fileSize: number | null;
  error: string | null;
}

export interface StorageStats {
  totalCachedBytes: number;
  downloadedCount: number;
  availableDiskBytes: number;
}

interface DownloadState {
  /** All tracked download items (mirrors SQLite downloads table). */
  downloads: DownloadItem[];

  /** Global download quality preference. */
  quality: DownloadQuality;

  /** Active download abort controllers for cancellation. */
  _abortControllers: Map<string, AbortController>;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Load all download items from SQLite into state. */
  loadDownloads: () => Promise<void>;

  /** Set global download quality preference. */
  setQuality: (quality: DownloadQuality) => void;

  /** Queue a track for download (enqueue to backend BullMQ). */
  queueDownload: (
    trackId: string,
    title: string,
    artist: string,
    artwork: string,
    duration: number
  ) => Promise<void>;

  /** Cancel an in-progress download. */
  cancelDownload: (trackId: string) => Promise<void>;

  /** Remove a completed/failed download from history. */
  removeDownload: (trackId: string) => Promise<void>;

  /** Also download and cache lyrics for a track. */
  downloadLyrics: (trackId: string, artist: string, title: string, duration: number) => Promise<void>;

  /** Get filesystem storage statistics. */
  getStorageStats: () => Promise<StorageStats>;

  /** Wipe all downloaded audio files and reset DB entries. */
  clearCache: () => Promise<void>;
}

// ─── Directory Setup ─────────────────────────────────────────────────────────

const DOWNLOADS_DIR = `${FileSystem.documentDirectory}vivi_downloads/`;

async function ensureDownloadsDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true });
  }
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloads: [],
  quality: 'high',
  _abortControllers: new Map(),

  loadDownloads: async () => {
    try {
      const rows = await db.execute(
        `SELECT d.*, t.title, t.artist FROM downloads d
         LEFT JOIN tracks t ON d.trackId = t.id
         ORDER BY d.startedAt DESC`
      );
      const items: DownloadItem[] = rows.map((r) => ({
        trackId: r.trackId,
        title: r.title || 'Unknown',
        artist: r.artist || 'Unknown',
        quality: r.quality as DownloadQuality,
        status: r.status as DownloadItem['status'],
        progress: r.progress || 0,
        filePath: r.filePath || null,
        fileSize: r.fileSize || null,
        error: r.error || null,
      }));
      set({ downloads: items });
    } catch (err) {
      console.warn('[DownloadStore] Failed to load downloads:', err);
    }
  },

  setQuality: (quality) => {
    set({ quality });
  },

  queueDownload: async (trackId, title, artist, artwork, duration) => {
    const { quality, downloads } = get();

    // Skip if already queued or completed
    if (downloads.some((d) => d.trackId === trackId && d.status !== 'failed')) {
      console.log(`[DownloadStore] Track ${trackId} already in queue, skipping.`);
      return;
    }

    await ensureDownloadsDir();

    // 1. Insert into SQLite
    await db.run(
      `INSERT OR REPLACE INTO downloads (trackId, quality, status, progress, startedAt)
       VALUES (?, ?, 'pending', 0, ?)`,
      [trackId, quality, Date.now()]
    );

    // 2. Update local state
    const newItem: DownloadItem = {
      trackId,
      title,
      artist,
      quality,
      status: 'pending',
      progress: 0,
      filePath: null,
      fileSize: null,
      error: null,
    };
    set((state) => ({ downloads: [newItem, ...state.downloads.filter((d) => d.trackId !== trackId)] }));

    // 3. Start the download via backend BullMQ API
    try {
      const abortController = new AbortController();
      get()._abortControllers.set(trackId, abortController);

      // Notify backend to enqueue the download job
      const response = await fetch(`${BACKEND_BASE_URL}/api/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': BACKEND_API_KEY,
        },
        body: JSON.stringify({ trackId, quality }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Backend enqueue failed: ${response.statusText}`);
      }

      const data = await response.json();
      const downloadUrl = data.downloadUrl;

      if (!downloadUrl) {
        throw new Error('No download URL returned from backend');
      }

      // 4. Update status to downloading
      set((state) => ({
        downloads: state.downloads.map((d) =>
          d.trackId === trackId ? { ...d, status: 'downloading' as const } : d
        ),
      }));
      await db.run(
        `UPDATE downloads SET status = 'downloading' WHERE trackId = ?`,
        [trackId]
      );

      // 5. Download the transcoded file to local storage
      const ext = quality === 'lossless' ? 'flac' : 'mp3';
      const destPath = `${DOWNLOADS_DIR}${trackId}.${ext}`;

      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        destPath,
        {},
        (downloadProgress) => {
          const progress =
            downloadProgress.totalBytesWritten /
            downloadProgress.totalBytesExpectedToWrite;
          set((state) => ({
            downloads: state.downloads.map((d) =>
              d.trackId === trackId ? { ...d, progress } : d
            ),
          }));
        }
      );

      const downloadResult = await downloadResumable.downloadAsync();
      if (!downloadResult) {
        throw new Error('Download returned no result');
      }

      // 6. Get file size
      const fileInfo = await FileSystem.getInfoAsync(destPath);
      const fileSize = fileInfo.exists ? (fileInfo as any).size || 0 : 0;

      // 7. Update completion status
      set((state) => ({
        downloads: state.downloads.map((d) =>
          d.trackId === trackId
            ? { ...d, status: 'complete' as const, progress: 1, filePath: destPath, fileSize }
            : d
        ),
      }));
      await db.run(
        `UPDATE downloads SET status = 'complete', progress = 1, filePath = ?, fileSize = ?, completedAt = ? WHERE trackId = ?`,
        [destPath, fileSize, Date.now(), trackId]
      );

      // 8. Also download lyrics for offline use
      get().downloadLyrics(trackId, artist, title, duration);

      get()._abortControllers.delete(trackId);
      console.log(`[DownloadStore] Download complete: ${title}`);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log(`[DownloadStore] Download cancelled: ${title}`);
        return;
      }

      console.error(`[DownloadStore] Download failed for ${title}:`, err);
      set((state) => ({
        downloads: state.downloads.map((d) =>
          d.trackId === trackId
            ? { ...d, status: 'failed' as const, error: err.message }
            : d
        ),
      }));
      await db.run(
        `UPDATE downloads SET status = 'failed', error = ? WHERE trackId = ?`,
        [err.message, trackId]
      );
      get()._abortControllers.delete(trackId);
    }
  },

  cancelDownload: async (trackId) => {
    const controller = get()._abortControllers.get(trackId);
    if (controller) {
      controller.abort();
      get()._abortControllers.delete(trackId);
    }

    await db.run(`DELETE FROM downloads WHERE trackId = ?`, [trackId]);
    set((state) => ({
      downloads: state.downloads.filter((d) => d.trackId !== trackId),
    }));

    // Clean up file if it exists
    try {
      const filePath = `${DOWNLOADS_DIR}${trackId}.*`;
      // Try common extensions
      for (const ext of ['mp3', 'flac', 'aac']) {
        const path = `${DOWNLOADS_DIR}${trackId}.${ext}`;
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) {
          await FileSystem.deleteAsync(path, { idempotent: true });
        }
      }
    } catch (_) {
      // Silent cleanup failure is acceptable
    }
  },

  removeDownload: async (trackId) => {
    await db.run(`DELETE FROM downloads WHERE trackId = ?`, [trackId]);
    set((state) => ({
      downloads: state.downloads.filter((d) => d.trackId !== trackId),
    }));
  },

  downloadLyrics: async (trackId, artist, title, duration) => {
    try {
      const result = await LyricsClient.getLyrics(trackId, artist, title, duration);
      if (result.lyrics.length > 0) {
        await db.run(
          `UPDATE downloads SET lyricsOffline = 1 WHERE trackId = ?`,
          [trackId]
        );
        console.log(`[DownloadStore] Lyrics cached offline for: ${title}`);
      }
    } catch (err) {
      console.warn(`[DownloadStore] Lyrics offline cache failed for: ${title}`, err);
    }
  },

  getStorageStats: async () => {
    try {
      await ensureDownloadsDir();

      // Count completed downloads
      const rows = await db.execute(
        `SELECT COUNT(*) as cnt, SUM(fileSize) as totalSize FROM downloads WHERE status = 'complete'`
      );
      const downloadedCount = rows[0]?.cnt || 0;
      const totalCachedBytes = rows[0]?.totalSize || 0;

      // Get available disk space
      const diskInfo = await FileSystem.getFreeDiskStorageAsync();

      return {
        totalCachedBytes,
        downloadedCount,
        availableDiskBytes: diskInfo,
      };
    } catch (err) {
      console.warn('[DownloadStore] Storage stats error:', err);
      return { totalCachedBytes: 0, downloadedCount: 0, availableDiskBytes: 0 };
    }
  },

  clearCache: async () => {
    try {
      // Delete all download files
      const info = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
      if (info.exists) {
        await FileSystem.deleteAsync(DOWNLOADS_DIR, { idempotent: true });
        await ensureDownloadsDir(); // Recreate empty directory
      }

      // Reset database entries
      await db.run(`DELETE FROM downloads`);
      set({ downloads: [] });

      console.log('[DownloadStore] Cache cleared successfully.');
    } catch (err) {
      console.error('[DownloadStore] Cache clear failed:', err);
    }
  },
}));
