import * as SecureStore from 'expo-secure-store';
import { Track } from 'react-native-track-player';

const VISITOR_ID_KEY = 'youtube_visitor_id';
const VISITOR_ID_EXPIRY_KEY = 'youtube_visitor_id_expiry';

export interface YouTubeTrack extends Track {
  videoId: string;
  urlExpiry?: number;
}

export class InnerTubeClient {
  /**
   * Fetches or retrieves cached X-Goog-Visitor-Id.
   */
  private static async getVisitorId(): Promise<string> {
    try {
      const cached = await SecureStore.getItemAsync(VISITOR_ID_KEY);
      const expiry = await SecureStore.getItemAsync(VISITOR_ID_EXPIRY_KEY);
      if (cached && expiry && Date.now() < Number(expiry)) {
        return cached;
      }
    } catch (e) {
      console.warn('[InnerTubeClient] Error reading cached visitor ID:', e);
    }

    try {
      console.log('[InnerTubeClient] Visitor ID missing or expired. Requesting new handshake...');
      const response = await fetch('https://music.youtube.com/youtubei/v1/visitor_id', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const visitorId = data.responseContext?.visitorData;
        if (visitorId) {
          await SecureStore.setItemAsync(VISITOR_ID_KEY, visitorId);
          // Cache for 24 hours
          await SecureStore.setItemAsync(VISITOR_ID_EXPIRY_KEY, (Date.now() + 24 * 60 * 60 * 1000).toString());
          console.log('[InnerTubeClient] Cached visitor ID:', visitorId);
          return visitorId;
        }
      }
    } catch (err) {
      console.error('[InnerTubeClient] Failed to fetch visitor ID:', err);
    }
    return '';
  }

  /**
   * Helper to recursively scan a JSON object for all nodes with a given key.
   */
  private static findNodes(obj: any, key: string, results: any[] = []): any[] {
    if (!obj || typeof obj !== 'object') {
      return results;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.findNodes(item, key, results);
      }
    } else {
      if (obj[key] !== undefined) {
        results.push(obj[key]);
      }
      for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          this.findNodes(obj[k], key, results);
        }
      }
    }
    return results;
  }

  /**
   * Helper to find a videoId inside a renderer.
   */
  private static findVideoId(item: any): string | null {
    if (item.playlistItemData?.videoId) return item.playlistItemData.videoId;
    if (item.videoId) return item.videoId;
    const endpointNodes = this.findNodes(item, 'watchEndpoint');
    if (endpointNodes.length > 0 && endpointNodes[0].videoId) {
      return endpointNodes[0].videoId;
    }
    return null;
  }

  /**
   * Helper to extract flat text from flex columns.
   */
  private static getFlexColumnText(column: any): string {
    const runs = column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    if (Array.isArray(runs)) {
      return runs.map((r: any) => r.text).join('');
    }
    return '';
  }

  /**
   * Helper to extract artwork URL from responsive layouts.
   */
  private static findArtwork(item: any): string | undefined {
    const thumbNodes = this.findNodes(item, 'thumbnails');
    if (thumbNodes.length > 0) {
      const urls = thumbNodes[0];
      if (Array.isArray(urls) && urls.length > 0) {
        return urls[urls.length - 1].url;
      }
    }
    const thumbNode = this.findNodes(item, 'thumbnail');
    if (thumbNode.length > 0) {
      const thumbnails = thumbNode[0]?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      if (Array.isArray(thumbnails) && thumbnails.length > 0) {
        return thumbnails[thumbnails.length - 1].url;
      }
    }
    return undefined;
  }

  /**
   * Helper to parse time strings like '3:45' or '1:02:15' to seconds.
   */
  private static parseDuration(durationStr: string): number {
    const parts = durationStr.split(':').map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1]; // MM:SS
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]; // H:MM:SS
    }
    return 0;
  }

  /**
   * Parses standard flex-column details for artist, album, and duration.
   */
  private static parseItemDetails(item: any) {
    const title = this.getFlexColumnText(item.flexColumns?.[0]) || 'Unknown Title';
    
    let artist = 'Unknown Artist';
    let album = 'Unknown Album';
    let durationSec = 0;

    const detailsText = item.flexColumns?.slice(1)
      .map((col: any) => this.getFlexColumnText(col))
      .filter(Boolean)
      .join(' • ');

    const parts = detailsText.split(/[•·]/).map((s: string) => s.trim());
    
    const filteredParts = parts.filter((p: string) => {
      const lower = p.toLowerCase();
      return lower !== 'song' && lower !== 'video' && lower !== 'album' && lower !== 'playlist' && lower !== 'single' && lower !== 'ep';
    });

    const durationIndex = filteredParts.findIndex((p: string) => /^\d+:\d+(:\d+)?$/.test(p));
    if (durationIndex !== -1) {
      durationSec = this.parseDuration(filteredParts[durationIndex]);
      filteredParts.splice(durationIndex, 1);
    }

    if (filteredParts.length > 0) {
      artist = filteredParts[0];
    }
    if (filteredParts.length > 1) {
      album = filteredParts[1];
    }

    return { title, artist, album, durationSec };
  }

  /**
   * Finds the continuation token recursively inside a YouTube response.
   */
  private static findContinuationToken(obj: any): string | null {
    if (!obj || typeof obj !== 'object') return null;
    
    if (obj.nextContinuationData?.continuation) {
      return obj.nextContinuationData.continuation;
    }
    if (obj.continuationCommand?.token) {
      return obj.continuationCommand.token;
    }
    
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const token = this.findContinuationToken(item);
        if (token) return token;
      }
    } else {
      for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          const token = this.findContinuationToken(obj[k]);
          if (token) return token;
        }
      }
    }
    
    return null;
  }

  /**
   * Maps search or browse responses to structured track elements.
   */
  private static extractTracksFromResponse(data: any): YouTubeTrack[] {
    const responsiveItems = this.findNodes(data, 'musicResponsiveListItemRenderer');
    const playlistVideos = this.findNodes(data, 'playlistVideoRenderer');
    
    const tracks: YouTubeTrack[] = [];
    
    for (const item of [...responsiveItems, ...playlistVideos]) {
      const videoId = this.findVideoId(item);
      if (!videoId) continue;
      
      let title = 'Unknown Title';
      let artist = 'Unknown Artist';
      let album = 'Unknown Album';
      let duration = 0;
      
      if (item.title) {
        if (typeof item.title === 'object') {
          title = item.title.runs?.[0]?.text || item.title.simpleText || 'Unknown Title';
        } else {
          title = item.title;
        }
      }
      
      if (item.flexColumns) {
        const parsed = this.parseItemDetails(item);
        title = parsed.title;
        artist = parsed.artist;
        album = parsed.album;
        duration = parsed.durationSec;
      } else {
        if (item.shortBylineText) {
          artist = item.shortBylineText.runs?.[0]?.text || 'Unknown Artist';
        }
        duration = item.lengthSeconds ? parseInt(item.lengthSeconds, 10) : 0;
      }
      
      const artwork = this.findArtwork(item) || `https://picsum.photos/200/200?seed=${videoId}`;
      
      tracks.push({
        id: videoId,
        videoId,
        url: '', // Default placeholder to satisfy Track interface
        title,
        artist,
        album,
        artwork,
        duration,
      });
    }
    
    // Deduplicate by videoId
    const seen = new Set<string>();
    return tracks.filter(t => {
      if (seen.has(t.videoId)) return false;
      seen.add(t.videoId);
      return true;
    });
  }

  /**
   * Search YouTube Music catalog for songs/videos.
   */
  public static async search(query: string): Promise<YouTubeTrack[]> {
    try {
      const visitorId = await this.getVisitorId();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };
      if (visitorId) {
        headers['X-Goog-Visitor-Id'] = visitorId;
      }

      console.log(`[InnerTubeClient] Searching for: "${query}"`);
      const response = await fetch('https://music.youtube.com/youtubei/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`InnerTube search failed: ${response.statusText}`);
      }

      const data = await response.json();
      return this.extractTracksFromResponse(data);
    } catch (error) {
      console.error('[InnerTubeClient] Search error:', error);
      return [];
    }
  }

  /**
   * Crawls a YouTube Music playlist recursively, index continuation tokens until done.
   */
  public static async fetchPlaylist(playlistId: string): Promise<YouTubeTrack[]> {
    try {
      const visitorId = await this.getVisitorId();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };
      if (visitorId) {
        headers['X-Goog-Visitor-Id'] = visitorId;
      }

      // Prefix with VL for browse if it's standard PL
      const browseId = playlistId.startsWith('PL') ? `VL${playlistId}` : playlistId;
      console.log(`[InnerTubeClient] Browsing playlist: "${browseId}"`);

      const response = await fetch('https://music.youtube.com/youtubei/v1/browse', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          browseId,
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`InnerTube browse playlist failed: ${response.statusText}`);
      }

      const data = await response.json();
      let tracks = this.extractTracksFromResponse(data);
      let continuationToken = this.findContinuationToken(data);

      let pageCount = 1;
      const maxPages = 15; // Crawl up to 1500 songs

      while (continuationToken && pageCount < maxPages) {
        console.log(`[InnerTubeClient] Crawling continuation token page ${pageCount + 1}...`);
        const contResponse = await fetch(`https://music.youtube.com/youtubei/v1/browse?continuation=${continuationToken}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            continuation: continuationToken,
            context: {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20240101.01.00',
                hl: 'en',
                gl: 'US',
              },
            },
          }),
        });

        if (!contResponse.ok) {
          console.warn(`[InnerTubeClient] Continuation page fetch failed: ${contResponse.statusText}`);
          break;
        }

        const contData = await contResponse.json();
        const newTracks = this.extractTracksFromResponse(contData);
        if (newTracks.length === 0) {
          break;
        }

        tracks.push(...newTracks);

        // Deduplicate tracks by videoId
        const seen = new Set<string>();
        tracks = tracks.filter(t => {
          if (seen.has(t.videoId)) return false;
          seen.add(t.videoId);
          return true;
        });

        continuationToken = this.findContinuationToken(contData);
        pageCount++;
      }

      console.log(`[InnerTubeClient] Successfully crawled ${tracks.length} items for playlist ${playlistId}`);
      return tracks;
    } catch (error) {
      console.error('[InnerTubeClient] Playlist crawl error:', error);
      return [];
    }
  }
}
