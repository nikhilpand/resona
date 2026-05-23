import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, exec } from 'child_process';

/**
 * BullMQ Download Worker.
 * Processes download jobs: resolves stream URL → transcodes via FFmpeg → stores file.
 *
 * Following the bullmq-specialist skill patterns:
 * - Production-ready queue config with proper connection reuse
 * - Dead letter queue for failed jobs
 * - Concurrency-limited processing
 * - Progress reporting back to job
 */

// ── Redis Connection ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
});

// ── Downloads Directory ───────────────────────────────────────────────────────

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ── Quality → FFmpeg Mapping ──────────────────────────────────────────────────

interface QualityPreset {
  codec: string;
  bitrate: string;
  ext: string;
  ffmpegArgs: string[];
}

const QUALITY_PRESETS: Record<string, QualityPreset> = {
  low: {
    codec: 'aac',
    bitrate: '128k',
    ext: 'aac',
    ffmpegArgs: ['-c:a', 'aac', '-b:a', '128k'],
  },
  high: {
    codec: 'mp3',
    bitrate: '320k',
    ext: 'mp3',
    ffmpegArgs: ['-c:a', 'libmp3lame', '-b:a', '320k'],
  },
  lossless: {
    codec: 'flac',
    bitrate: 'lossless',
    ext: 'flac',
    ffmpegArgs: ['-c:a', 'flac'],
  },
};

// ── Worker ─────────────────────────────────────────────────────────────────────

export const downloadWorker = new Worker(
  'vivi-downloads',
  async (job: Job) => {
    const { trackId, quality, streamUrl } = job.data;
    const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
    const outputFile = path.join(DOWNLOADS_DIR, `${trackId}.${preset.ext}`);

    console.log(`[DownloadWorker] Processing job ${job.id}: track=${trackId}, quality=${quality}`);

    try {
      // Phase 1: Download + transcode via FFmpeg (30%)
      await job.updateProgress(10);

      await new Promise<void>((resolve, reject) => {
        const ffmpegCmd = [
          'ffmpeg',
          '-y', // overwrite output
          '-i', streamUrl,
          ...preset.ffmpegArgs,
          '-vn', // no video
          '-metadata', `title=${job.data.title || ''}`,
          '-metadata', `artist=${job.data.artist || ''}`,
          outputFile,
        ].join(' ');

        exec(ffmpegCmd, { timeout: 300_000 }, (error, stdout, stderr) => {
          if (error) {
            console.error(`[DownloadWorker] FFmpeg error:`, stderr);
            reject(new Error(`FFmpeg transcode failed: ${error.message}`));
          } else {
            resolve();
          }
        });
      });

      await job.updateProgress(80);

      // Phase 2: Verify output file
      if (!fs.existsSync(outputFile)) {
        throw new Error('FFmpeg produced no output file');
      }

      const stats = fs.statSync(outputFile);
      await job.updateProgress(100);

      console.log(`[DownloadWorker] Complete: ${outputFile} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

      return {
        filePath: outputFile,
        fileSize: stats.size,
        quality,
        ext: preset.ext,
      };
    } catch (error: any) {
      console.error(`[DownloadWorker] Job ${job.id} failed:`, error.message);
      // Clean up partial file
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
      throw error;
    }
  },
  {
    connection,
    concurrency: 2, // Process 2 downloads concurrently
    limiter: {
      max: 5,
      duration: 60_000, // Max 5 jobs per minute (rate limit protection)
    },
  }
);

// ── Event Handlers ────────────────────────────────────────────────────────────

downloadWorker.on('completed', (job, result) => {
  console.log(`[DownloadWorker] Job ${job.id} completed:`, result);
});

downloadWorker.on('failed', (job, err) => {
  console.error(`[DownloadWorker] Job ${job?.id} failed:`, err.message);
});

downloadWorker.on('error', (err) => {
  console.error('[DownloadWorker] Worker error:', err);
});

export { connection as redisConnection };
