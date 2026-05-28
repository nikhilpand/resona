import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

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

const PORT = parseInt(process.env.BACKEND_PORT || '3000', 10);
const PROXY_API_KEY = process.env.EXPO_PUBLIC_BACKEND_API_KEY || 'vivi_secure_dev_key';

// ── Player URL Cache ──────────────────────────────────────────────────────────

/**
 * YouTube rotates the player JS hash frequently.
 * We dynamically extract the current player URL from the watch page
 * and cache it for 1 hour.
 */
let cachedPlayerUrl: string | null = null;
let playerUrlCachedAt = 0;
const PLAYER_URL_TTL_MS = 60 * 60 * 1000; // 1 hour

const INNERTUBE_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://music.youtube.com',
  'Referer': 'https://music.youtube.com/',
};

const INNERTUBE_CONTEXT_WEB = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20260213.01.00',
    hl: 'en',
    gl: 'US',
  },
};

/**
 * ANDROID_VR_1_43_32 — primary client used by vivi-music.
 * Returns direct stream URLs with no PoToken, cipher, or auth required.
 * Client ID 28 = ANDROID_VR in the InnerTube registry.
 */
const INNERTUBE_CONTEXT_ANDROID_VR = {
  client: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.43.32',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: '32',
    osName: 'Android',
    osVersion: '12L',
    hl: 'en',
    gl: 'US',
  },
};

const ANDROID_VR_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  'X-YouTube-Client-Name': '28',
  'X-YouTube-Client-Version': '1.43.32',
};

// Fallback: standard Android Music client
const INNERTUBE_CONTEXT_ANDROID = {
  client: {
    clientName: 'ANDROID_MUSIC',
    clientVersion: '6.42.52',
    androidSdkVersion: 30,
    hl: 'en',
    gl: 'US',
  },
};

async function getDynamicPlayerUrl(): Promise<string> {
  const now = Date.now();
  if (cachedPlayerUrl && now - playerUrlCachedAt < PLAYER_URL_TTL_MS) {
    return cachedPlayerUrl;
  }

  try {
    fastify.log.info('[PlayerUrl] Fetching current YouTube player URL...');
    const resp = await axios.get('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      headers: {
        'User-Agent': INNERTUBE_HEADERS['User-Agent'],
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10_000,
    });
    const html: string = resp.data;
    const match = html.match(/\/s\/player\/([a-f0-9]+)\/player_ias\.vflset\/[a-z_A-Z]+\/base\.js/);
    if (match) {
      cachedPlayerUrl = `https://www.youtube.com${match[0]}`;
      playerUrlCachedAt = now;
      fastify.log.info(`[PlayerUrl] Resolved: ${cachedPlayerUrl}`);
      return cachedPlayerUrl;
    }
    throw new Error('Player URL regex did not match HTML');
  } catch (err: any) {
    fastify.log.warn(`[PlayerUrl] Dynamic fetch failed (${err.message}), using known fallback.`);
    // Known-good fallback — expires eventually but better than nothing
    return 'https://www.youtube.com/s/player/9dadf1f9/player_ias.vflset/en_US/base.js';
  }
}

// ── Cipher Decipher ───────────────────────────────────────────────────────────

const decipherCache = new Map<string, any[]>();

async function getDecipherOperations(playerUrl: string): Promise<any[]> {
  if (decipherCache.has(playerUrl)) {
    return decipherCache.get(playerUrl)!;
  }

  const { data: jsCode } = await axios.get(playerUrl, { timeout: 15_000 });

  const mainFuncRegex = /([a-zA-Z0-9$]+)=function\([a-zA-Z0-9$]+\)\{[a-zA-Z0-9$]+\.split\(""\);([a-zA-Z0-9$]+)\./;
  const match = jsCode.match(mainFuncRegex);
  if (!match) {
    fastify.log.warn('[Decipher] Main cipher function not found in player JS');
    return [];
  }

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
  fastify.log.info(`[Decipher] Compiled ${actions.length} cipher ops for ${playerUrl}`);
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
      case 'swap': {
        const temp = chars[0];
        chars[0] = chars[action.arg % chars.length];
        chars[action.arg % chars.length] = temp;
        break;
      }
    }
  }
  return chars.join('');
}

// ── n-param deobfuscation (throttle bypass) ──────────────────────────────────

function deobfuscateNParam(jsCode: string, n: string): string {
  try {
    // Find the n-param obfuscation function
    const nFuncMatch = jsCode.match(/\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]+)(?:\[(\d+)\])?\([a-zA-Z0-9$]+\)/);
    if (!nFuncMatch) return n;

    const nFuncName = nFuncMatch[1];
    const nFuncBodyMatch = jsCode.match(new RegExp(`${nFuncName}=function\\(a\\)\\{[\\s\\S]+?\\}`));
    if (!nFuncBodyMatch) return n;

    // Safely evaluate the n-param function using Function constructor
    // eslint-disable-next-line no-new-func
    const nFunc = new Function('a', nFuncBodyMatch[0].replace(`${nFuncName}=function(a)`, 'return function(a)') + '(a)');
    return nFunc(n) as string;
  } catch {
    return n;
  }
}

// ── Stream URL Resolution ─────────────────────────────────────────────────────

/**
 * Resolves a streaming URL for a YouTube video.
 *
 * Strategy:
 * 1. Try ANDROID_MUSIC client — returns direct URLs without cipher
 * 2. Fall back to WEB_REMIX client with dynamic cipher decoding
 */
async function resolveStreamUrl(videoId: string): Promise<{ url: string; expiresIn: number; headers: Record<string, string> }> {
  // ── Strategy 1: ANDROID_VR client (vivi-music primary, no cipher needed) ──
  try {
    const vrResp = await axios.post(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      { videoId, context: INNERTUBE_CONTEXT_ANDROID_VR },
      { headers: ANDROID_VR_HEADERS, timeout: 15_000 }
    );

    const streamingData = vrResp.data?.streamingData;
    if (streamingData?.adaptiveFormats) {
      const formats: any[] = streamingData.adaptiveFormats;
      const audioFormat =
        formats.find((f) => f.mimeType?.includes('audio/webm') && f.mimeType?.includes('opus') && f.url) ||
        formats.find((f) => f.mimeType?.includes('audio/') && f.url);

      if (audioFormat?.url) {
        fastify.log.info(`[Resolve] ANDROID_VR client succeeded for ${videoId}`);
        const expires = streamingData.expiresInSeconds ? parseInt(streamingData.expiresInSeconds, 10) : 6 * 60 * 60;
        return { url: audioFormat.url, expiresIn: expires, headers: ANDROID_VR_HEADERS };
      }
    }
    fastify.log.info(`[Resolve] ANDROID_VR client returned no direct URL for ${videoId}, trying ANDROID_MUSIC...`);
  } catch (err: any) {
    fastify.log.warn(`[Resolve] ANDROID_VR client error: ${err.message}`);
  }

  // ── Strategy 2: Android Music client (no cipher needed) ──────────────────
  try {
    const androidResp = await axios.post(
      'https://music.youtube.com/youtubei/v1/player?prettyPrint=false',
      { videoId, context: INNERTUBE_CONTEXT_ANDROID },
      { headers: INNERTUBE_HEADERS, timeout: 15_000 }
    );

    const streamingData = androidResp.data?.streamingData;
    if (streamingData?.adaptiveFormats) {
      const formats: any[] = streamingData.adaptiveFormats;
      const audioFormat =
        formats.find((f) => f.mimeType?.includes('audio/webm') && f.mimeType?.includes('opus') && f.url) ||
        formats.find((f) => f.mimeType?.includes('audio/') && f.url);

      if (audioFormat?.url) {
        fastify.log.info(`[Resolve] Android client succeeded for ${videoId}`);
        const expires = streamingData.expiresInSeconds ? parseInt(streamingData.expiresInSeconds, 10) : 6 * 60 * 60;
        return { url: audioFormat.url, expiresIn: expires, headers: INNERTUBE_HEADERS };
      }
    }
    fastify.log.info(`[Resolve] Android client returned no direct URL for ${videoId}, trying WEB_REMIX...`);
  } catch (err: any) {
    fastify.log.warn(`[Resolve] Android client error: ${err.message}`);
  }

  // ── Strategy 3: WEB_REMIX + dynamic cipher decoding ──────────────────────
  const webResp = await axios.post(
    'https://music.youtube.com/youtubei/v1/player?prettyPrint=false',
    { videoId, context: INNERTUBE_CONTEXT_WEB },
    { headers: INNERTUBE_HEADERS, timeout: 15_000 }
  );

  const streamingData = webResp.data?.streamingData;
  if (!streamingData?.adaptiveFormats) {
    throw new Error('No audio streams found in WEB_REMIX response');
  }

  const formats: any[] = streamingData.adaptiveFormats;
  const optimalFormat =
    formats.find((f) => f.mimeType?.includes('audio/webm') && f.mimeType?.includes('opus')) ||
    formats.find((f) => f.mimeType?.includes('audio/'));

  if (!optimalFormat) {
    throw new Error('No suitable audio format found');
  }

  let streamUrl: string = optimalFormat.url || '';

  // Decipher signatureCipher if direct URL is absent
  if (!streamUrl && optimalFormat.signatureCipher) {
    const cipher = optimalFormat.signatureCipher;
    const urlMatch = cipher.match(/url=([^&]+)/);
    const sMatch = cipher.match(/[^a-z]s=([^&]+)/);
    const spMatch = cipher.match(/sp=([^&]+)/);

    if (!urlMatch || !sMatch) {
      throw new Error('Could not parse signatureCipher fields');
    }

    const encryptedSig = decodeURIComponent(sMatch[1]);
    const rawUrl = decodeURIComponent(urlMatch[1]);
    const paramName = spMatch ? decodeURIComponent(spMatch[1]) : 'sig';

    const playerUrl = await getDynamicPlayerUrl();
    const { data: jsCode } = await axios.get(playerUrl, { timeout: 15_000 });
    const actions = await getDecipherOperations(playerUrl);
    const signature = decipherSignature(encryptedSig, actions);

    // Also deobfuscate n-param to remove throttling
    const urlObj = new URL(rawUrl);
    const nParam = urlObj.searchParams.get('n');
    if (nParam) {
      const deobfN = deobfuscateNParam(jsCode, nParam);
      urlObj.searchParams.set('n', deobfN);
    }

    streamUrl = `${urlObj.toString()}&${paramName}=${signature}`;
  }

  if (!streamUrl) {
    throw new Error('Could not extract streaming URL from any strategy');
  }

  fastify.log.info(`[Resolve] WEB_REMIX cipher strategy succeeded for ${videoId}`);
  return { url: streamUrl, expiresIn: 6 * 60 * 60, headers: INNERTUBE_HEADERS };
}

// ── In-memory download job store (replaces BullMQ/Redis) ─────────────────────

type JobStatus = 'queued' | 'downloading' | 'complete' | 'failed';

interface DownloadJob {
  trackId: string;
  quality: string;
  status: JobStatus;
  progress: number; // 0–100
  downloadUrl: string;
  error?: string;
  startedAt: number;
}

const downloadJobs = new Map<string, DownloadJob>();

function getJobKey(trackId: string, quality: string) {
  return `${trackId}-${quality}`;
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
 * Starts a direct download job (no Redis/BullMQ required).
 * Streams the audio directly to disk via axios, then transcodes if ffmpeg is available.
 * Falls back to storing the raw webm/opus stream if ffmpeg is absent.
 */
fastify.post('/api/download', async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== PROXY_API_KEY) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }

  const { trackId, quality = 'high' } = request.body as {
    trackId: string;
    quality?: string;
    title?: string;
    artist?: string;
  };

  if (!trackId) {
    reply.status(400).send({ error: 'Missing trackId' });
    return;
  }

  const jobKey = getJobKey(trackId, quality);

  // Return existing job if already running/complete
  const existing = downloadJobs.get(jobKey);
  if (existing && existing.status === 'complete') {
    reply.send({ jobId: jobKey, downloadUrl: existing.downloadUrl, status: 'complete' });
    return;
  }
  if (existing && existing.status === 'downloading') {
    reply.send({ jobId: jobKey, downloadUrl: existing.downloadUrl, status: 'downloading' });
    return;
  }

  const ext = quality === 'lossless' ? 'opus' : quality === 'low' ? 'aac' : 'mp3';
  const outputFile = path.join(DOWNLOADS_DIR, `${trackId}.${ext}`);
  const host = (request.headers['host'] || `localhost:${PORT}`).split(':')[0];
  const downloadUrl = `http://${host}:${PORT}/downloads/${trackId}.${ext}`;

  const job: DownloadJob = {
    trackId,
    quality,
    status: 'queued',
    progress: 0,
    downloadUrl,
    startedAt: Date.now(),
  };
  downloadJobs.set(jobKey, job);

  // Reply immediately with job ID — client should poll /status
  reply.send({ jobId: jobKey, downloadUrl, status: 'queued' });

  // ── Async background processing ──────────────────────────────────────────
  (async () => {
    try {
      // 1. Resolve stream URL
      fastify.log.info(`[Download] Resolving stream for ${trackId}...`);
      job.status = 'downloading';
      job.progress = 5;

      const { url: streamUrl, headers: resolveHeaders } = await resolveStreamUrl(trackId);

      // 2. Stream audio to temp file with Range/Resume support
      const tmpFile = path.join(DOWNLOADS_DIR, `${trackId}.tmp`);
      await downloadStreamWithResume(streamUrl, resolveHeaders, tmpFile, (progress) => {
        job.progress = progress;
      });

      job.progress = 80;
      fastify.log.info(`[Download] Stream saved to ${tmpFile}`);

      // 3. Try FFmpeg transcode (optional — graceful degradation if not installed)
      const ffmpegAvailable = await isFfmpegAvailable();

      if (ffmpegAvailable && quality !== 'lossless') {
        fastify.log.info(`[Download] Transcoding to ${quality}...`);
        job.status = 'downloading';
        job.progress = 85;

        await transcodeWithFfmpeg(tmpFile, outputFile, quality);
        fs.unlinkSync(tmpFile); // remove temp file after transcode
      } else {
        // No FFmpeg: rename tmp to output (raw opus/webm is playable by most players)
        fastify.log.info(`[Download] FFmpeg not available — saving raw stream as ${ext}`);
        fs.renameSync(tmpFile, outputFile);
      }

      job.status = 'complete';
      job.progress = 100;
      fastify.log.info(`[Download] Complete: ${outputFile}`);
    } catch (err: any) {
      fastify.log.error(`[Download] Failed for ${trackId}: ${err.message}`);
      job.status = 'failed';
      job.error = err.message;
      // Clean up partial files
      for (const f of [`${trackId}.tmp`, `${trackId}.${ext}`]) {
        const p = path.join(DOWNLOADS_DIR, f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
  })();
});

// ── Route: GET /api/download/:trackId/status ──────────────────────────────────

fastify.get('/api/download/:trackId/status', async (request, reply) => {
  const { trackId } = request.params as { trackId: string };
  const { quality = 'high' } = request.query as { quality?: string };
  const jobKey = getJobKey(trackId, quality);
  const job = downloadJobs.get(jobKey);

  if (!job) {
    reply.status(404).send({ error: 'No download job found' });
    return;
  }

  reply.send({
    trackId,
    quality: job.quality,
    status: job.status,
    progress: job.progress,
    downloadUrl: job.status === 'complete' ? job.downloadUrl : null,
    error: job.error || null,
  });
});

// ── Route: POST /api/search-isrc ──────────────────────────────────────────────

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
    // Strategy 1: ISRC search
    if (isrc) {
      const isrcResponse = await axios.post(
        'https://music.youtube.com/youtubei/v1/search',
        { query: isrc, context: INNERTUBE_CONTEXT_WEB },
        { headers: INNERTUBE_HEADERS }
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
      { query, context: INNERTUBE_CONTEXT_WEB },
      { headers: INNERTUBE_HEADERS }
    );

    const results = extractVideoIds(searchResponse.data);
    reply.send({ matches: results, method: 'search' });
  } catch (error: any) {
    fastify.log.error(error);
    reply.status(500).send({ error: 'ISRC search failed', details: error.message });
  }
});

// ── Helper: Download stream with resume/range support ─────────────────────────

async function downloadStreamWithResume(
  streamUrl: string,
  headers: Record<string, string>,
  tmpFile: string,
  onProgress: (progress: number) => void
): Promise<void> {
  const maxRetries = 5;
  let retries = 0;
  let totalBytes = 0;
  let writtenBytes = 0;

  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }

  while (retries < maxRetries) {
    let streamResp;
    try {
      const requestHeaders: Record<string, string> = {
        ...headers,
        'Referer': 'https://music.youtube.com/',
      };

      if (writtenBytes > 0) {
        requestHeaders['Range'] = `bytes=${writtenBytes}-`;
        console.log(`[Download] Resuming from byte ${writtenBytes}...`);
      }

      streamResp = await axios.get(streamUrl, {
        responseType: 'stream',
        timeout: 30000,
        headers: requestHeaders,
      });

      if (writtenBytes === 0) {
        totalBytes = parseInt(streamResp.headers['content-length'] || '0', 10);
      } else {
        const contentRange = streamResp.headers['content-range'];
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)/);
          if (match) totalBytes = parseInt(match[1], 10);
        }
      }

      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(tmpFile, { flags: writtenBytes > 0 ? 'a' : 'w' });

        writer.on('open', () => {
          streamResp.data.on('data', (chunk: Buffer) => {
            writer.write(chunk);
            writtenBytes += chunk.length;
            if (totalBytes > 0) {
              onProgress(Math.round(5 + (writtenBytes / totalBytes) * 75));
            }
          });

          streamResp.data.on('end', () => {
            writer.end();
          });
        });

        writer.on('finish', () => {
          resolve();
        });

        writer.on('error', (err: any) => {
          writer.end();
          reject(err);
        });

        streamResp.data.on('error', (err: any) => {
          writer.end();
          reject(err);
        });
      });

      if (totalBytes === 0 || writtenBytes >= totalBytes) {
        return;
      }
    } catch (err: any) {
      console.warn(`[Download] Connection interrupted at byte ${writtenBytes}/${totalBytes}: ${err.message}`);
      retries++;
      if (retries >= maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// ── Helper: FFmpeg availability check ─────────────────────────────────────────

async function isFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('ffmpeg -version', { timeout: 5000 }, (err: any) => resolve(!err));
  });
}

// ── Helper: FFmpeg transcode ──────────────────────────────────────────────────

async function transcodeWithFfmpeg(inputFile: string, outputFile: string, quality: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');

    const qualityArgs: Record<string, string> = {
      low: '-c:a aac -b:a 128k',
      high: '-c:a libmp3lame -b:a 320k',
      lossless: '-c:a flac',
    };
    const args = qualityArgs[quality] || qualityArgs.high;

    const cmd = `ffmpeg -y -i "${inputFile}" ${args} -vn "${outputFile}"`;
    fastify.log.info(`[FFmpeg] ${cmd}`);

    exec(cmd, { timeout: 600_000 }, (err: any, _stdout: string, stderr: string) => {
      if (err) {
        reject(new Error(`FFmpeg failed: ${stderr || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

// ── Helper: Extract videoIds from search response ─────────────────────────────

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

    const title =
      item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
    const artistRuns =
      item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const artist = Array.isArray(artistRuns) ? artistRuns.map((r: any) => r.text).join('') : '';

    results.push({ videoId, title, artist });
  }

  return results.slice(0, 5);
}

// ── Health check ──────────────────────────────────────────────────────────────

fastify.get('/health', async () => {
  const activeJobs = [...downloadJobs.values()].filter((j) => j.status === 'downloading').length;
  const completedJobs = [...downloadJobs.values()].filter((j) => j.status === 'complete').length;
  return {
    status: 'healthy',
    service: 'resona-backend-proxy',
    downloads: { active: activeJobs, completed: completedJobs },
  };
});

// ── Start ─────────────────────────────────────────────────────────────────────

const start = async () => {
  // Warn if ffmpeg not available (downloads will use raw stream)
  const hasFFmpeg = await isFfmpegAvailable();
  if (!hasFFmpeg) {
    console.warn('[Proxy] ⚠️  ffmpeg not found — downloads will save raw audio (no transcoding). Install with: sudo apt install ffmpeg');
  } else {
    console.log('[Proxy] ✅ ffmpeg available');
  }

  // Pre-warm player URL cache
  getDynamicPlayerUrl().catch(() => {});

  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[Proxy] Server listening on http://localhost:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
