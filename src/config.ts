import { Platform } from 'react-native';

/**
 * Centralized app configuration.
 * Single source of truth for all API keys, endpoints, and feature constants.
 */

// ─── Backend Proxy ───────────────────────────────────────────────────────────
const BACKEND_PORT = 3000;
export const BACKEND_BASE_URL = Platform.OS === 'android'
  ? `http://10.0.2.2:${BACKEND_PORT}`
  : `http://localhost:${BACKEND_PORT}`;

export const BACKEND_API_KEY =
  process.env.EXPO_PUBLIC_BACKEND_API_KEY || 'vivi_secure_dev_key';

// ─── Spotify OAuth2 PKCE ─────────────────────────────────────────────────────
export const SPOTIFY_CLIENT_ID = 'cdb7876485e741fc81618dafb044a17c';
export const SPOTIFY_REDIRECT_URI =
  'https://dlcmbfsopftarzseusxt.supabase.co/auth/v1/callback';
export const SPOTIFY_SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-modify-private',
].join(' ');

// ─── Google OAuth2 ───────────────────────────────────────────────────────────
export const GOOGLE_CLIENT_ID_IOS =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS || '';
export const GOOGLE_CLIENT_ID_ANDROID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID || '';

// ─── Download Quality ────────────────────────────────────────────────────────
export type DownloadQuality = 'low' | 'high' | 'lossless';

export const DOWNLOAD_QUALITY_OPTIONS: {
  key: DownloadQuality;
  label: string;
  detail: string;
}[] = [
  { key: 'low', label: 'Standard', detail: '128 kbps AAC' },
  { key: 'high', label: 'High Quality', detail: '320 kbps MP3' },
  { key: 'lossless', label: 'Lossless', detail: 'FLAC' },
];

// ─── Stream Cache ────────────────────────────────────────────────────────────
/** How long resolved YouTube stream URLs remain valid (ms). */
export const STREAM_URL_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Safety buffer before considering a cached URL "expired" (ms). */
export const STREAM_URL_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

// ─── Lyrics Cache ────────────────────────────────────────────────────────────
/** Lyrics cache validity period (ms). */
export const LYRICS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── InnerTube / YouTube ─────────────────────────────────────────────────────
export const INNERTUBE_CLIENT_NAME = 'WEB_REMIX';
export const INNERTUBE_CLIENT_VERSION = '1.20240101.01.00';
export const INNERTUBE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Max continuation pages to crawl for a single playlist (each ~100 tracks). */
export const INNERTUBE_MAX_CONTINUATION_PAGES = 15;

/** Visitor ID validity period (ms). */
export const INNERTUBE_VISITOR_ID_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Playback ────────────────────────────────────────────────────────────────
/** Pre-resolve threshold (0.0–1.0). When progress reaches this, pre-resolve next track. */
export const PRE_RESOLVE_THRESHOLD = 0.8;

/** Search debounce delay (ms). */
export const SEARCH_DEBOUNCE_MS = 600;
