import { SpotifyAuth } from '../auth/SpotifyAuth';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpotifyTrack {
  spotifyId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  duration: number; // seconds
  isrc: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  trackCount: number;
  artwork: string;
  owner: string;
}

export interface AudioFeatures {
  spotifyId: string;
  tempo: number;
  valence: number;
  energy: number;
  acousticness: number;
}

export interface SpotifyUserProfile {
  email: string;
  displayName: string;
  imageUrl: string | null;
}

// ─── Client ──────────────────────────────────────────────────────────────────

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const PAGE_SIZE = 50;

/**
 * Authenticated Spotify Web API client.
 * All methods auto-refresh tokens via SpotifyAuth.getAccessToken().
 */
export class SpotifyClient {
  // ── Auth Helper ─────────────────────────────────────────────────────────────

  private static async authFetch(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const token = await SpotifyAuth.getAccessToken();
    if (!token) {
      throw new Error('Not authenticated with Spotify');
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Token expired mid-request — attempt one retry after refresh
      const refreshedToken = await SpotifyAuth.getAccessToken();
      if (!refreshedToken) throw new Error('Spotify re-auth failed');

      return fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${refreshedToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    }

    return response;
  }

  // ── User Profile ────────────────────────────────────────────────────────────

  /** Fetches the authenticated user's profile. */
  public static async getProfile(): Promise<SpotifyUserProfile> {
    const response = await this.authFetch(`${SPOTIFY_API_BASE}/me`);
    if (!response.ok) throw new Error(`Profile fetch failed: ${response.statusText}`);

    const data = await response.json();
    const profile: SpotifyUserProfile = {
      email: data.email || '',
      displayName: data.display_name || 'Spotify User',
      imageUrl: data.images?.[0]?.url || null,
    };

    // Cache email for display in settings
    if (profile.email) {
      await SpotifyAuth.setUserEmail(profile.email);
    }

    return profile;
  }

  // ── Liked Tracks ────────────────────────────────────────────────────────────

  /** Fetches all liked/saved tracks, paginated recursively. */
  public static async getLikedTracks(): Promise<SpotifyTrack[]> {
    const tracks: SpotifyTrack[] = [];
    let url: string | null = `${SPOTIFY_API_BASE}/me/tracks?limit=${PAGE_SIZE}&offset=0`;

    while (url) {
      console.log(`[SpotifyClient] Fetching liked tracks (${tracks.length} so far)...`);
      const response = await this.authFetch(url);
      if (!response.ok) break;

      const data = await response.json();
      for (const item of data.items || []) {
        const parsed = this.parseTrackItem(item.track);
        if (parsed) tracks.push(parsed);
      }

      url = data.next; // Spotify provides the next page URL or null
    }

    console.log(`[SpotifyClient] Fetched ${tracks.length} liked tracks total.`);
    return tracks;
  }

  // ── Playlists ───────────────────────────────────────────────────────────────

  /** Fetches all user playlists (paginated). */
  public static async getPlaylists(): Promise<SpotifyPlaylist[]> {
    const playlists: SpotifyPlaylist[] = [];
    let url: string | null = `${SPOTIFY_API_BASE}/me/playlists?limit=${PAGE_SIZE}&offset=0`;

    while (url) {
      const response = await this.authFetch(url);
      if (!response.ok) break;

      const data = await response.json();
      for (const item of data.items || []) {
        playlists.push({
          id: item.id,
          name: item.name,
          trackCount: item.tracks?.total || 0,
          artwork: item.images?.[0]?.url || '',
          owner: item.owner?.display_name || 'Unknown',
        });
      }

      url = data.next;
    }

    console.log(`[SpotifyClient] Fetched ${playlists.length} playlists.`);
    return playlists;
  }

  /** Fetches all tracks within a specific playlist (paginated). */
  public static async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    const tracks: SpotifyTrack[] = [];
    let url: string | null =
      `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks?limit=${PAGE_SIZE}&offset=0`;

    while (url) {
      const response = await this.authFetch(url);
      if (!response.ok) break;

      const data = await response.json();
      for (const item of data.items || []) {
        const parsed = this.parseTrackItem(item.track);
        if (parsed) tracks.push(parsed);
      }

      url = data.next;
    }

    console.log(`[SpotifyClient] Fetched ${tracks.length} tracks for playlist ${playlistId}.`);
    return tracks;
  }

  // ── Audio Features ──────────────────────────────────────────────────────────

  /**
   * Fetches audio features for batches of track IDs (max 100 per request).
   * Returns valence, energy, tempo, acousticness for mood-based playlists.
   */
  public static async getAudioFeatures(
    trackIds: string[]
  ): Promise<AudioFeatures[]> {
    const results: AudioFeatures[] = [];

    // Process in batches of 100 (Spotify API limit)
    for (let i = 0; i < trackIds.length; i += 100) {
      const batch = trackIds.slice(i, i + 100);
      const ids = batch.join(',');

      try {
        const response = await this.authFetch(
          `${SPOTIFY_API_BASE}/audio-features?ids=${ids}`
        );
        if (!response.ok) {
          console.warn(`[SpotifyClient] Audio features batch failed: ${response.statusText}`);
          continue;
        }

        const data = await response.json();
        for (const feature of data.audio_features || []) {
          if (!feature) continue; // Spotify returns null for unavailable tracks
          results.push({
            spotifyId: feature.id,
            tempo: feature.tempo || 0,
            valence: feature.valence || 0,
            energy: feature.energy || 0,
            acousticness: feature.acousticness || 0,
          });
        }
      } catch (err) {
        console.warn('[SpotifyClient] Audio features batch error:', err);
      }
    }

    console.log(`[SpotifyClient] Fetched audio features for ${results.length}/${trackIds.length} tracks.`);
    return results;
  }

  // ── Parser ──────────────────────────────────────────────────────────────────

  private static parseTrackItem(track: any): SpotifyTrack | null {
    if (!track || !track.id) return null;

    return {
      spotifyId: track.id,
      title: track.name || 'Unknown Title',
      artist: track.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
      album: track.album?.name || '',
      artwork:
        track.album?.images?.[0]?.url ||
        `https://picsum.photos/200/200?seed=${track.id}`,
      duration: Math.round((track.duration_ms || 0) / 1000),
      isrc: track.external_ids?.isrc || null,
    };
  }
}
