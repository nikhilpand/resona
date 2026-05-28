/**
 * BullMQ Download Worker — optional, only used when Redis is available.
 * The primary download path is now handled directly in server.ts.
 * This worker is kept for high-volume deployments with Redis.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true, // Don't crash on startup if Redis isn't available
});

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

interface QualityPreset {
  codec: string;
  bitrate: string;
  ext: string;
  ffmpegArgs: string;
}

const QUALITY_PRESETS: Record<string, QualityPreset> = {
  low: { codec: 'aac', bitrate: '128k', ext: 'aac', ffmpegArgs: '-c:a aac -b:a 128k' },
  high: { codec: 'mp3', bitrate: '320k', ext: 'mp3', ffmpegArgs: '-c:a libmp3lame -b:a 320k' },
  lossless: { codec: 'flac', bitrate: 'lossless', ext: 'flac', ffmpegArgs: '-c:a flac' },
};

async function runFfmpeg(inputFile: string, outputFile: string, quality: string): Promise<void> {
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputFile}" ${preset.ffmpegArgs} -vn "${outputFile}"`;
    exec(cmd, { timeout: 600_000 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`FFmpeg failed: ${stderr || error.message}`));
      } else {
        resolve();
      }
    });
  });
}

// Only start worker if Redis connection can be established
connection.on('connect', () => {
  console.log('[DownloadWorker] Redis connected — worker starting.');

  const downloadWorker = new Worker(
    'vivi-downloads',
    async (job: Job) => {
      const { trackId, quality, streamUrl } = job.data;
      const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
      const tmpFile = path.join(DOWNLOADS_DIR, `${trackId}.tmp`);
      const outputFile = path.join(DOWNLOADS_DIR, `${trackId}.${preset.ext}`);

      console.log(`[DownloadWorker] Processing job ${job.id}: track=${trackId}, quality=${quality}`);

      try {
        await job.updateProgress(10);

        // Stream to temp file using axios (imported lazily to avoid circular deps)
        const axios = require('axios');
        const streamResp = await axios.get(streamUrl, {
          responseType: 'stream',
          timeout: 0,
        });
        const writer = fs.createWriteStream(tmpFile);

        await new Promise<void>((resolve, reject) => {
          streamResp.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        await job.updateProgress(60);

        // Transcode
        await runFfmpeg(tmpFile, outputFile, quality);
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

        await job.updateProgress(100);

        const stats = fs.statSync(outputFile);
        console.log(`[DownloadWorker] Complete: ${outputFile} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

        return { filePath: outputFile, fileSize: stats.size, quality, ext: preset.ext };
      } catch (error: any) {
        console.error(`[DownloadWorker] Job ${job.id} failed:`, error.message);
        for (const f of [tmpFile, outputFile]) {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        throw error;
      }
    },
    {
      connection,
      concurrency: 2,
    }
  );

  downloadWorker.on('completed', (job, result) => {
    console.log(`[DownloadWorker] Job ${job.id} completed:`, result);
  });

  downloadWorker.on('failed', (job, err) => {
    console.error(`[DownloadWorker] Job ${job?.id} failed:`, err.message);
  });
});

connection.on('error', (err) => {
  // Silently ignore — Redis is optional, primary downloads run in-process
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DownloadWorker] Redis unavailable — BullMQ worker not started (using in-process downloads).');
  }
});

// Attempt connection
connection.connect().catch(() => {
  // Non-fatal — primary download system doesn't need Redis
});

export { connection as redisConnection };
