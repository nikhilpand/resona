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

  /** Active polling timers for cancellation. */
  _pollTimers: Map<string, ReturnType<typeof setTimeout>>;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Load all download items from SQLite into state. */
  loadDownloads: () => Promise<void>;

  /** Set global download quality preference. */
  setQuality: (quality: DownloadQuality) => void;

  /** Queue a track for download. */
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

// ─── Poll helper ─────────────────────────────────────────────────────────────

/**
 * Polls the backend job status endpoint until the job is complete or failed.
 * Uses exponential backoff: 2s, 4s, 6s, 8s… capped at 15s, max 40 attempts (~10 min).
 */
async function pollJobUntilComplete(
  trackId: string,
  quality: string,
  onProgress: (progress: number) => void,
  cancelSignal: { cancelled: boolean }
): Promise<{ downloadUrl: string } | null> {
  const MAX_ATTEMPTS = 40;
  const BASE_DELAY_MS = 2000;
  const MAX_DELAY_MS = 15000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (cancelSignal.cancelled) return null;

    try {
      const resp = await fetch(
        `${BACKEND_BASE_URL}/api/download/${trackId}/status?quality=${quality}`,
        { headers: { 'x-api-key': BACKEND_API_KEY } }
      );

      if (resp.ok) {
        const data = await resp.json();
        const { status, progress, downloadUrl } = data;

        if (status === 'complete' && downloadUrl) {
          onProgress(1.0);
          return { downloadUrl };
        }

        if (status === 'failed') {
          throw new Error(data.error || 'Backend download job failed');
        }

        // Still in progress — update progress (maps 0-100 → 0.05–0.90)
        if (typeof progress === 'number') {
          onProgress(0.05 + (progress / 100) * 0.85);
        }
      }
    } catch (err: any) {
      if (err.message?.includes('failed')) throw err; // propagate real failures
      // Network error — keep retrying
    }

    const delay = Math.min(BASE_DELAY_MS + attempt * 1000, MAX_DELAY_MS);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw new Error('Download timed out after 10 minutes');
}

// ─── Store ───────────────────────────────────────────────────────────────────

// Track cancel signals outside of store to avoid Zustand proxy issues
const _cancelSignals = new Map<string, { cancelled: boolean }>();

export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloads: [],
  quality: 'high',
  _pollTimers: new Map(),

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

    // Skip if already queued or completed successfully
    if (downloads.some((d) => d.trackId === trackId && d.status !== 'failed')) {
      console.log(`[DownloadStore] Track ${trackId} already queued, skipping.`);
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
    set((state) => ({
      downloads: [newItem, ...state.downloads.filter((d) => d.trackId !== trackId)],
    }));

    // 3. Create cancel signal
    const cancelSignal = { cancelled: false };
    _cancelSignals.set(trackId, cancelSignal);

    // 4. Enqueue to backend (start the job)
    try {
      const enqueueResp = await fetch(`${BACKEND_BASE_URL}/api/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': BACKEND_API_KEY,
        },
        body: JSON.stringify({ trackId, quality }),
      });

      if (!enqueueResp.ok) {
        throw new Error(`Backend enqueue failed: ${enqueueResp.statusText}`);
      }

      // 5. Update status to downloading
      set((state) => ({
        downloads: state.downloads.map((d) =>
          d.trackId === trackId ? { ...d, status: 'downloading' as const } : d
        ),
      }));
      await db.run(`UPDATE downloads SET status = 'downloading' WHERE trackId = ?`, [trackId]);

      // 6. Poll backend until job completes (the file is being processed server-side)
      const result = await pollJobUntilComplete(
        trackId,
        quality,
        (progress) => {
          set((state) => ({
            downloads: state.downloads.map((d) =>
              d.trackId === trackId ? { ...d, progress } : d
            ),
          }));
        },
        cancelSignal
      );

      if (!result || cancelSignal.cancelled) {
        console.log(`[DownloadStore] Download cancelled: ${title}`);
        return;
      }

      // 7. Download the completed file from backend to device storage
      const ext = quality === 'lossless' ? 'opus' : quality === 'low' ? 'aac' : 'mp3';
      const destPath = `${DOWNLOADS_DIR}${trackId}.${ext}`;

      const downloadResumable = FileSystem.createDownloadResumable(
        result.downloadUrl,
        destPath,
        {},
        (downloadProgress) => {
          const fileProgress = downloadProgress.totalBytesExpectedToWrite > 0
            ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
            : 0;
          // Map 90–100%
          set((state) => ({
            downloads: state.downloads.map((d) =>
              d.trackId === trackId ? { ...d, progress: 0.90 + fileProgress * 0.10 } : d
            ),
          }));
        }
      );

      const downloadResult = await downloadResumable.downloadAsync();
      if (!downloadResult) {
        throw new Error('FileSystem download returned no result');
      }

      // 8. Get file size
      const fileInfo = await FileSystem.getInfoAsync(destPath);
      const fileSize = fileInfo.exists ? (fileInfo as any).size || 0 : 0;

      // 9. Mark complete
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

      // 10. Cache lyrics in background (non-blocking)
      get().downloadLyrics(trackId, artist, title, duration).catch(() => {});

      _cancelSignals.delete(trackId);
      console.log(`[DownloadStore] Download complete: ${title}`);
    } catch (err: any) {
      if (cancelSignal.cancelled) {
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
      _cancelSignals.delete(trackId);
    }
  },

  cancelDownload: async (trackId) => {
    // Signal any in-flight poll loop to stop
    const signal = _cancelSignals.get(trackId);
    if (signal) {
      signal.cancelled = true;
      _cancelSignals.delete(trackId);
    }

    await db.run(`DELETE FROM downloads WHERE trackId = ?`, [trackId]);
    set((state) => ({
      downloads: state.downloads.filter((d) => d.trackId !== trackId),
    }));

    // Clean up any partial local files
    try {
      for (const ext of ['mp3', 'flac', 'aac', 'opus', 'tmp']) {
        const p = `${DOWNLOADS_DIR}${trackId}.${ext}`;
        const info = await FileSystem.getInfoAsync(p);
        if (info.exists) {
          await FileSystem.deleteAsync(p, { idempotent: true });
        }
      }
    } catch (_) {
      // Silent cleanup failure is acceptable
    }
  },

  removeDownload: async (trackId) => {
    // Also clean up local file
    try {
      const item = get().downloads.find((d) => d.trackId === trackId);
      if (item?.filePath) {
        const info = await FileSystem.getInfoAsync(item.filePath);
        if (info.exists) {
          await FileSystem.deleteAsync(item.filePath, { idempotent: true });
        }
      }
    } catch (_) {}

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

      const rows = await db.execute(
        `SELECT COUNT(*) as cnt, SUM(fileSize) as totalSize FROM downloads WHERE status = 'complete'`
      );
      const downloadedCount = rows[0]?.cnt || 0;
      const totalCachedBytes = rows[0]?.totalSize || 0;

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
      const info = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
      if (info.exists) {
        await FileSystem.deleteAsync(DOWNLOADS_DIR, { idempotent: true });
        await ensureDownloadsDir();
      }

      await db.run(`DELETE FROM downloads`);
      set({ downloads: [] });

      console.log('[DownloadStore] Cache cleared successfully.');
    } catch (err) {
      console.error('[DownloadStore] Cache clear failed:', err);
    }
  },
}));
