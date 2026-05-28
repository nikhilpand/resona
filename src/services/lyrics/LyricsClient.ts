import { db } from '../../db/client';
import { LrcParser, LyricLine } from './LrcParser';

export interface LyricsResponse {
  lyrics: LyricLine[];
  source: 'database' | 'lrclib' | 'kugou' | 'simpmusic' | 'youlyplus' | 'mock';
}

export class LyricsClient {
  /**
   * Orchestrates the lyrics waterfall resolution.
   */
  public static async getLyrics(trackId: string, artist: string, title: string, durationSec?: number): Promise<LyricsResponse> {
    try {
      // 1. Look up cached lyrics in SQLite database
      const dbResult = await db.execute(
        'SELECT lyricsJson, source, updatedAt FROM cached_lyrics WHERE trackId = ?',
        [trackId]
      );

      if (dbResult && dbResult.length > 0) {
        const updatedAt = dbResult[0].updatedAt || 0;
        const CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
        
        if (Date.now() - updatedAt < CACHE_EXPIRY_MS) {
          console.log(`[LyricsClient] Cache hit in local SQLite for: ${title}`);
          const parsed = JSON.parse(dbResult[0].lyricsJson) as LyricLine[];
          return {
            lyrics: parsed,
            source: 'database',
          };
        } else {
          console.log(`[LyricsClient] Cache expired for: ${title}. Refreshing online...`);
        }
      }

      // 2. Query SimpMusic Lyrics API (precise match by YouTube videoId)
      console.log(`[LyricsClient] Fetching from SimpMusic for videoId: ${trackId}`);
      const simpMusicData = await this.fetchFromSimpMusic(trackId, durationSec);
      if (simpMusicData) {
        const parsed = LrcParser.parse(simpMusicData);
        await this.cacheLyrics(trackId, parsed, 'simpmusic');
        return {
          lyrics: parsed,
          source: 'simpmusic',
        };
      }

      // 3. Query LRCLib API
      console.log(`[LyricsClient] Fetching from LRCLib for: ${title}`);
      const lrcLibData = await this.fetchFromLrcLib(artist, title, durationSec);
      if (lrcLibData) {
        const parsed = LrcParser.parse(lrcLibData);
        await this.cacheLyrics(trackId, parsed, 'lrclib');
        return {
          lyrics: parsed,
          source: 'lrclib',
        };
      }

      // 4. Query YouLyPlus KPoe API
      console.log(`[LyricsClient] Fetching from YouLyPlus for: ${title}`);
      const youLyPlusData = await this.fetchFromYouLyPlus(artist, title, durationSec);
      if (youLyPlusData) {
        const parsed = LrcParser.parse(youLyPlusData);
        await this.cacheLyrics(trackId, parsed, 'youlyplus');
        return {
          lyrics: parsed,
          source: 'youlyplus',
        };
      }

      // 5. Fallback to Kugou Search API
      console.log(`[LyricsClient] Fetching from Kugou for: ${title}`);
      const kugouData = await this.fetchFromKugou(artist, title);
      if (kugouData) {
        const parsed = LrcParser.parse(kugouData);
        await this.cacheLyrics(trackId, parsed, 'kugou');
        return {
          lyrics: parsed,
          source: 'kugou',
        };
      }

    } catch (error) {
      console.warn('[LyricsClient] Error in waterfall resolution:', error);
    }

    // 4. Ultimate Mock Fallback to guarantee a playback experience
    console.log(`[LyricsClient] All fetch sources missed. Returning mock lyrics for: ${title}`);
    const mockLrc = `
      [00:00.00] • • •
      [00:05.00] (Instrumental Intro)
      [00:12.00] <00:12.00> Far <00:12.80> away
      [00:15.00] <00:15.00> Ship <00:15.30> is <00:15.60> taking <00:16.00> me <00:16.40> far <00:17.00> away
      [00:19.00] <00:19.00> Find <00:19.20> a <00:19.40> state <00:20.00> where <00:20.30> I <00:20.50> can <00:21.00> be <00:21.40> alone
      [00:25.00] <00:25.00> Without <00:25.30> any <00:25.60> care <00:26.00> in <00:26.20> the <00:27.00> world
      [00:31.00] <00:31.00> Now <00:31.40> I <00:32.00> see <00:32.40> the <00:33.00> light
      [00:37.00] <00:37.00> Shining <00:37.50> through <00:38.00> the <00:38.50> ambient <00:39.00> pulse
      [00:44.00] <00:44.00> Taking <00:44.50> over <00:45.00> my <00:45.50> soul
      [00:50.00] <00:50.00> And <00:50.30> I <00:50.60> am <00:51.00> home
      [00:55.00] • • •
    `;
    const parsedMock = LrcParser.parse(mockLrc);
    await this.cacheLyrics(trackId, parsedMock, 'mock');
    return {
      lyrics: parsedMock,
      source: 'mock',
    };
  }

  /**
   * Fetches lyrics from LRCLib API.
   */
  private static async fetchFromLrcLib(artist: string, title: string, durationSec?: number): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        artist_name: artist,
        track_name: title,
      });
      if (durationSec) {
        params.append('duration', durationSec.toString());
      }

      const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
      if (!response.ok) return null;
      
      const data = await response.json();
      return data.syncedLyrics || data.plainLyrics || null;
    } catch {
      return null;
    }
  }

  /**
   * Fallback: Fetches lyrics from Kugou Music search service.
   */
  private static async fetchFromKugou(artist: string, title: string): Promise<string | null> {
    try {
      const query = encodeURIComponent(`${artist} ${title}`);
      
      // Step A: Search for the song ID/hash
      const searchUrl = `https://songsearch.kugou.com/song_search_v2?keyword=${query}&page=1&pagesize=1&userid=0&clientver=&platform=WebFilter`;
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) return null;
      
      const searchData = await searchRes.json();
      const songHash = searchData.data?.lists?.[0]?.FileHash;
      if (!songHash) return null;

      // Step B: Fetch the parsed lyrics from the hash
      const lyricsUrl = `https://m.kugou.com/app/i/krc.php?cmd=100&timelength=999999&hash=${songHash}`;
      const lyricsRes = await fetch(lyricsUrl);
      if (!lyricsRes.ok) return null;

      const lyricsLrc = await lyricsRes.text();
      return lyricsLrc && lyricsLrc.trim().length > 0 ? lyricsLrc : null;
    } catch {
      return null;
    }
  }

  private static async fetchWithTimeout(url: string, options: any = {}): Promise<Response> {
    const { timeout = 6000, ...fetchOptions } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    }).finally(() => {
      clearTimeout(id);
    });
  }

  /**
   * Fetches lyrics from SimpMusic Lyrics API using the exact YouTube videoId.
   */
  private static async fetchFromSimpMusic(videoId: string, durationSec?: number): Promise<string | null> {
    try {
      const urls = [
        `https://api-lyrics.simpmusic.org/v1/${videoId}`,
        `https://vivi-yt-music-server.onrender.com/v1/${videoId}`
      ];

      for (const url of urls) {
        try {
          const response = await this.fetchWithTimeout(url, { timeout: 6000 });
          if (!response.ok) continue;

          const data = await response.json();
          if (data && data.success && Array.isArray(data.data)) {
            const tracks = data.data;
            if (tracks.length === 0) continue;

            const duration = durationSec || 0;
            const validTracks = duration > 0 
              ? tracks.filter((t: any) => Math.abs((t.duration || 0) - duration) <= 10)
              : tracks;

            if (validTracks.length === 0) continue;

            let bestMatch = validTracks[0];
            if (duration > 0 && validTracks.length > 1) {
              let minDiff = Math.abs((validTracks[0].duration || 0) - duration);
              for (const track of validTracks) {
                const diff = Math.abs((track.duration || 0) - duration);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestMatch = track;
                }
              }
            }

            const lyrics = bestMatch.richSyncLyrics || bestMatch.syncedLyrics || bestMatch.plainLyrics;
            if (lyrics && lyrics.trim().length > 0) {
              console.log(`[LyricsClient] SimpMusic succeeded for ${videoId}`);
              return lyrics;
            }
          }
        } catch (_) {
          // ignore and try next fallback url
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Fetches lyrics from YouLyPlus / LyricsPlus servers in parallel, returning the first success.
   */
  private static async fetchFromYouLyPlus(artist: string, title: string, durationSec?: number): Promise<string | null> {
    const servers = [
      "https://lyricsplus.prjktla.my.id",
      "https://lyricsplus.atomix.one",
      "https://lyricsplus.binimum.org",
      "https://lyricsplus.prjktla.workers.dev",
      "https://lyricsplus-seven.vercel.app",
      "https://lyrics-plus-backend.vercel.app"
    ];

    const duration = durationSec ? Math.round(durationSec) : 0;
    const queryParams = new URLSearchParams({
      title,
      artist,
      duration: duration.toString()
    });

    const fetchPromises = servers.map(async (server) => {
      try {
        const url = `${server.replace(/\/$/, '')}/v2/lyrics/get?${queryParams.toString()}`;
        const response = await this.fetchWithTimeout(url, { timeout: 6000 });
        if (!response.ok) throw new Error("Request failed");

        const data = await response.json();
        
        let lrc = data.syncedLyrics;
        if (!lrc && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
          lrc = this.convertToLrc(data.lyrics);
        }
        if (!lrc) {
          lrc = data.plainLyrics;
        }

        if (lrc && lrc.trim().length > 0) {
          return lrc;
        }
        throw new Error("No lyrics in response");
      } catch (err) {
        throw err;
      }
    });

    try {
      // Racing promises
      const result = await new Promise<string>((resolve, reject) => {
        let rejectedCount = 0;
        fetchPromises.forEach((p) => {
          p.then(resolve).catch(() => {
            rejectedCount++;
            if (rejectedCount === fetchPromises.length) {
              reject(new Error("All YouLyPlus servers failed"));
            }
          });
        });
      });
      console.log(`[LyricsClient] YouLyPlus succeeded`);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Helper to convert YouLyPlus structured lyrics to standard LRC format
   */
  private static convertToLrc(lyricsItems: any[]): string | null {
    try {
      return lyricsItems.map((item) => {
        const lineTime = item.time || 0;
        const lineTimestamp = this.formatTime(lineTime);
        const bgMarker = item.syllabus?.some((s: any) => s.isBackground === true) ? "{bg}" : "";

        if (Array.isArray(item.syllabus) && item.syllabus.length > 0) {
          let sb = lineTimestamp + bgMarker;
          for (const syl of item.syllabus) {
            const sylTime = syl.time || 0;
            const sylTimestamp = this.formatTime(sylTime, true);
            sb += sylTimestamp + (syl.text || "");
            if (!syl.text?.endsWith(" ")) {
              sb += " ";
            }
          }
          return sb.trim();
        } else {
          return lineTimestamp + bgMarker + (item.text || "");
        }
      }).join("\n");
    } catch {
      return null;
    }
  }

  private static formatTime(timeMs: number, isSyllable = false): string {
    const minutes = Math.floor((timeMs / 1000) / 60);
    const seconds = Math.floor((timeMs / 1000) % 60);
    const millis = timeMs % 1000;
    const prefix = isSyllable ? "<" : "[";
    const suffix = isSyllable ? ">" : "]";
    return `${prefix}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}${suffix}`;
  }

  /**
   * Caches lyrics locally to prevent subsequent network calls.
   */
  private static async cacheLyrics(trackId: string, lyrics: LyricLine[], source: string): Promise<void> {
    try {
      const json = JSON.stringify(lyrics);
      await db.run(
        'INSERT OR REPLACE INTO cached_lyrics (trackId, lyricsJson, source, updatedAt) VALUES (?, ?, ?, ?)',
        [trackId, json, source, Date.now()]
      );
    } catch (e) {
      console.warn('[LyricsClient] Failed to cache lyrics:', e);
    }
  }
}
