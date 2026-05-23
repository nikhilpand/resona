import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

dotenv.config();

const fastify = Fastify({ logger: true });

// Register CORS for mobile client cross-origin queries
fastify.register(cors, {
  origin: '*',
});

// ── Downloads directory + static file serving ─────────────────────────────────

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

fastify.register(fastifyStatic, {
  root: DOWNLOADS_DIR,
  prefix: '/downloads/',
  decorateReply: false,
});

const PORT = 3000;
const PROXY_API_KEY = process.env.EXPO_PUBLIC_BACKEND_API_KEY || 'vivi_secure_dev_key';

// ── BullMQ Queue ──────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const downloadQueue = new Queue('vivi-downloads', { connection: redisConnection });

// Cache for decipher operations to avoid repeating base.js fetches
const decipherCache = new Map<string, any[]>();

/**
 * Primitive signature cipher decipher operations compiler
 */
async function getDecipherOperations(playerUrl: string): Promise<any[]> {
  if (decipherCache.has(playerUrl)) {
    return decipherCache.get(playerUrl)!;
  }

  const { data: jsCode } = await axios.get(playerUrl);

  const mainFuncRegex = /([a-zA-Z0-9$]+)=function\([a-zA-Z0-9$]+\)\{[a-zA-Z0-9$]+\.split\(""\);([a-zA-Z0-9$]+)\./;
  const match = jsCode.match(mainFuncRegex);
  if (!match) return [];

  const mainFuncName = match[1];
  const helperObjName = match[2];

  const funcBodyPattern = new RegExp(`${mainFuncName}=function\\(a\\)\\{([\\s\\S]*?)\\}`);
  const funcBodyMatch = jsCode.match(funcBodyPattern);
  if (!funcBodyMatch) return [];
  const funcLines = funcBodyMatch[1].split(';');

  const helperObjPattern = new RegExp(`var ${helperObjName}=\\{([\\s\\S]*?)\\};`);
  const helperMatch = jsCode.match(helperObjPattern);
  if (!helperMatch) return [];
  const helperDefinition = helperMatch[1];

  const actions: any[] = [];

  for (const line of funcLines) {
    if (!line.includes(`${helperObjName}.`)) continue;

    const actionMatch = line.match(new RegExp(`${helperObjName}\\.([a-zA-Z0-9$]+)\\(a,(\\d+)\\)`));
    if (!actionMatch) continue;

    const actionKey = actionMatch[1];
    const argument = parseInt(actionMatch[2], 10);

    const opRegex = new RegExp(`${actionKey}:function\\(a[^)]*\\)\\{([^}]+)\\}`);
    const opMatch = helperDefinition.match(opRegex);
    if (!opMatch) continue;

    const opBody = opMatch[1];
    if (opBody.includes('reverse')) {
      actions.push({ type: 'reverse' });
    } else if (opBody.includes('splice') || opBody.includes('slice')) {
      actions.push({ type: 'slice', arg: argument });
    } else {
      actions.push({ type: 'swap', arg: argument });
    }
  }

  decipherCache.set(playerUrl, actions);
  return actions;
}

function decipherSignature(s: string, actions: any[]): string {
  const chars = s.split('');
  for (const action of actions) {
    switch (action.type) {
      case 'reverse':
        chars.reverse();
        break;
      case 'slice':
        chars.splice(0, action.arg);
        break;
      case 'swap':
        const temp = chars[0];
        chars[0] = chars[action.arg % chars.length];
        chars[action.arg % chars.length] = temp;
        break;
    }
  }
  return chars.join('');
}

/**
 * Resolves a streaming URL for a YouTube video. Shared logic used by
 * both /api/resolve (on-the-fly playback) and /api/download (transcoding).
 */
async function resolveStreamUrl(videoId: string): Promise<{ url: string; expiresIn: number }> {
  const response = await axios.post(
    'https://music.youtube.com/youtubei/v1/player',
    {
      videoId,
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240101.01.00',
          hl: 'en',
          gl: 'US',
        },
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    }
  );

  const streamingData = response.data?.streamingData;
  if (!streamingData || !streamingData.adaptiveFormats) {
    throw new Error('No audio streams found');
  }

  const formats = streamingData.adaptiveFormats;
  const optimalFormat = formats.find((f: any) =>
    f.mimeType.includes('audio/webm') && f.mimeType.includes('codecs="opus"')
  ) || formats.find((f: any) => f.mimeType.includes('audio/'));

  if (!optimalFormat) {
    throw new Error('No audio codecs resolved');
  }

  let streamUrl = optimalFormat.url;

  if (!streamUrl && optimalFormat.signatureCipher) {
    const cipher = optimalFormat.signatureCipher;
    const urlMatch = cipher.match(/url=([^&]+)/);
    const sMatch = cipher.match(/s=([^&]+)/);
    const spMatch = cipher.match(/sp=([^&]+)/);

    if (urlMatch && sMatch) {
      const encryptedSig = decodeURIComponent(sMatch[1]);
      let rawUrl = decodeURIComponent(urlMatch[1]);
      const paramName = spMatch ? decodeURIComponent(spMatch[1]) : 'sig';

      const playerUrl = 'https://www.youtube.com/s/player/cd34cfbe/player_ias.vflset/en_US/base.js';
      const actions = await getDecipherOperations(playerUrl);
      const signature = decipherSignature(encryptedSig, actions);

      streamUrl = `${rawUrl}&${paramName}=${signature}`;
    }
  }

  if (!streamUrl) {
    throw new Error('Could not extract streaming URL');
  }

  return { url: streamUrl, expiresIn: 6 * 60 * 60 };
}

// ── Route: POST /api/resolve ──────────────────────────────────────────────────

fastify.post('/api/resolve', async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== PROXY_API_KEY) {
    reply.status(401).send({ error: 'Unauthorized gateway access' });
    return;
  }

  const { videoId } = request.body as { videoId: string };
  if (!videoId) {
    reply.status(400).send({ error: 'Missing videoId' });
    return;
  }

  try {
    const result = await resolveStreamUrl(videoId);
    reply.send(result);
  } catch (error: any) {
    fastify.log.error(error);
    reply.status(500).send({ error: 'Proxy resolution error', details: error.message });
  }
});

// ── Route: POST /api/download ─────────────────────────────────────────────────

/**
 * Enqueues a download job to BullMQ. The worker will:
 * 1. Resolve the stream URL
 * 2. Transcode via FFmpeg to the requested quality
 * 3. Store the file in /downloads/
 *
 * Returns a downloadUrl that the mobile client can fetch once the job completes.
 */
fastify.post('/api/download', async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== PROXY_API_KEY) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }

  const { trackId, quality = 'high', title, artist } = request.body as {
    trackId: string;
    quality?: string;
    title?: string;
    artist?: string;
  };

  if (!trackId) {
    reply.status(400).send({ error: 'Missing trackId' });
    return;
  }

  try {
    // First resolve the stream URL so the worker has it ready
    const { url: streamUrl } = await resolveStreamUrl(trackId);

    // Enqueue the download job to BullMQ
    const job = await downloadQueue.add(
      'transcode',
      { trackId, quality, streamUrl, title, artist },
      {
        jobId: `dl-${trackId}-${quality}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      }
    );

    const ext = quality === 'lossless' ? 'flac' : quality === 'low' ? 'aac' : 'mp3';
    const downloadUrl = `http://${request.hostname}:${PORT}/downloads/${trackId}.${ext}`;

    reply.send({
      jobId: job.id,
      downloadUrl,
      status: 'queued',
    });
  } catch (error: any) {
    fastify.log.error(error);
    reply.status(500).send({ error: 'Download enqueue failed', details: error.message });
  }
});

// ── Route: GET /api/download/:trackId/status ──────────────────────────────────

fastify.get('/api/download/:trackId/status', async (request, reply) => {
  const { trackId } = request.params as { trackId: string };

  try {
    for (const quality of ['high', 'low', 'lossless']) {
      const job = await downloadQueue.getJob(`dl-${trackId}-${quality}`);
      if (job) {
        const state = await job.getState();
        const progress = job.progress;
        reply.send({ trackId, quality, state, progress });
        return;
      }
    }

    reply.status(404).send({ error: 'No download job found' });
  } catch (error: any) {
    reply.status(500).send({ error: error.message });
  }
});

// ── Route: POST /api/search-isrc ──────────────────────────────────────────────

/**
 * Searches YouTube Music for a track by ISRC code, falling back to title+artist.
 * Used by the mobile client's ISRCResolver for Spotify cross-referencing.
 */
fastify.post('/api/search-isrc', async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== PROXY_API_KEY) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }

  const { isrc, title, artist } = request.body as {
    isrc?: string;
    title: string;
    artist: string;
  };

  if (!title && !isrc) {
    reply.status(400).send({ error: 'Missing isrc or title' });
    return;
  }

  try {
    const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    };
    const context = {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20240101.01.00',
        hl: 'en',
        gl: 'US',
      },
    };

    // Strategy 1: ISRC search
    if (isrc) {
      const isrcResponse = await axios.post(
        'https://music.youtube.com/youtubei/v1/search',
        { query: isrc, context },
        { headers }
      );

      const results = extractVideoIds(isrcResponse.data);
      if (results.length > 0) {
        reply.send({ matches: results, method: 'isrc' });
        return;
      }
    }

    // Strategy 2: Title + Artist fallback
    const query = `${artist} ${title}`;
    const searchResponse = await axios.post(
      'https://music.youtube.com/youtubei/v1/search',
      { query, context },
      { headers }
    );

    const results = extractVideoIds(searchResponse.data);
    reply.send({ matches: results, method: 'search' });
  } catch (error: any) {
    fastify.log.error(error);
    reply.status(500).send({ error: 'ISRC search failed', details: error.message });
  }
});

/**
 * Recursively extracts videoId + title + artist from InnerTube search response.
 */
function extractVideoIds(data: any): Array<{ videoId: string; title: string; artist: string }> {
  const results: Array<{ videoId: string; title: string; artist: string }> = [];

  function findNodes(obj: any, key: string, out: any[] = []): any[] {
    if (!obj || typeof obj !== 'object') return out;
    if (Array.isArray(obj)) {
      for (const item of obj) findNodes(item, key, out);
    } else {
      if (obj[key] !== undefined) out.push(obj[key]);
      for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          findNodes(obj[k], key, out);
        }
      }
    }
    return out;
  }

  const renderers = findNodes(data, 'musicResponsiveListItemRenderer');
  for (const item of renderers) {
    let videoId: string | null = null;
    if (item.playlistItemData?.videoId) videoId = item.playlistItemData.videoId;
    if (!videoId) {
      const endpoints = findNodes(item, 'watchEndpoint');
      if (endpoints.length > 0 && endpoints[0].videoId) videoId = endpoints[0].videoId;
    }
    if (!videoId) continue;

    const title = item.flexColumns?.[0]
      ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';

    const artistRuns = item.flexColumns?.[1]
      ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const artist = Array.isArray(artistRuns)
      ? artistRuns.map((r: any) => r.text).join('')
      : '';

    results.push({ videoId, title, artist });
  }

  return results.slice(0, 5);
}

// ── Health check ──────────────────────────────────────────────────────────────

fastify.get('/health', async () => {
  const queueCount = await downloadQueue.getJobCounts();
  return {
    status: 'healthy',
    service: 'vivi-backend-proxy',
    downloadQueue: queueCount,
  };
});

// ── Start ─────────────────────────────────────────────────────────────────────

const start = async () => {
  // Import the download worker (starts processing)
  try {
    await import('./workers/downloadWorker');
    console.log('[Proxy] Download worker initialized.');
  } catch (err) {
    console.warn('[Proxy] Download worker not loaded (Redis may be unavailable):', err);
  }

  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[Proxy] Server listening on http://localhost:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
