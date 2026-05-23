import { InnerTubeClient, YouTubeTrack } from '../youtube/InnerTubeClient';
import { SpotifyTrack } from '../spotify/SpotifyClient';

/**
 * Resolves Spotify tracks to YouTube equivalents using ISRC codes
 * as the primary match key, with title+artist fuzzy search as fallback.
 *
 * Implements concurrency-limited parallel resolution to avoid rate limiting.
 */

/** Result of cross-referencing a single Spotify track to YouTube. */
export interface ResolvedTrack {
  spotifyTrack: SpotifyTrack;
  youtubeTrack: YouTubeTrack | null;
  matchMethod: 'isrc' | 'search' | 'none';
  matchConfidence: number; // 0.0 – 1.0
}

const CONCURRENCY_LIMIT = 3;

export class ISRCResolver {
  // ── Single Track Resolution ─────────────────────────────────────────────────

  /**
   * Resolves a single Spotify track to a YouTube equivalent.
   * Strategy:
   * 1. ISRC search (highest accuracy, ~95% match rate)
   * 2. Title + Artist text search (fallback, fuzzy ranked)
   */
  public static async resolveOne(spotifyTrack: SpotifyTrack): Promise<ResolvedTrack> {
    // Strategy 1: ISRC Search
    if (spotifyTrack.isrc) {
      try {
        const isrcResults = await InnerTubeClient.search(spotifyTrack.isrc);
        if (isrcResults.length > 0) {
          // Verify the match against title/artist
          const best = this.pickBestMatch(
            isrcResults,
            spotifyTrack.title,
            spotifyTrack.artist
          );
          if (best && best.confidence >= 0.4) {
            console.log(
              `[ISRCResolver] ISRC match: "${spotifyTrack.title}" → "${best.track.title}" (${(best.confidence * 100).toFixed(0)}%)`
            );
            return {
              spotifyTrack,
              youtubeTrack: best.track,
              matchMethod: 'isrc',
              matchConfidence: best.confidence,
            };
          }
        }
      } catch (err) {
        console.warn(`[ISRCResolver] ISRC search failed for ${spotifyTrack.isrc}:`, err);
      }
    }

    // Strategy 2: Title + Artist text search
    try {
      const query = `${spotifyTrack.artist} ${spotifyTrack.title}`;
      const searchResults = await InnerTubeClient.search(query);
      if (searchResults.length > 0) {
        const best = this.pickBestMatch(
          searchResults,
          spotifyTrack.title,
          spotifyTrack.artist
        );
        if (best && best.confidence >= 0.3) {
          console.log(
            `[ISRCResolver] Search match: "${spotifyTrack.title}" → "${best.track.title}" (${(best.confidence * 100).toFixed(0)}%)`
          );
          return {
            spotifyTrack,
            youtubeTrack: best.track,
            matchMethod: 'search',
            matchConfidence: best.confidence,
          };
        }
      }
    } catch (err) {
      console.warn(`[ISRCResolver] Text search failed for "${spotifyTrack.title}":`, err);
    }

    // No match found
    console.log(`[ISRCResolver] No match found for: "${spotifyTrack.title}" by ${spotifyTrack.artist}`);
    return {
      spotifyTrack,
      youtubeTrack: null,
      matchMethod: 'none',
      matchConfidence: 0,
    };
  }

  // ── Batch Resolution ────────────────────────────────────────────────────────

  /**
   * Resolves an array of Spotify tracks concurrently (limited to CONCURRENCY_LIMIT
   * parallel operations to avoid rate limiting).
   */
  public static async resolveMany(
    spotifyTracks: SpotifyTrack[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<ResolvedTrack[]> {
    const results: ResolvedTrack[] = [];
    const total = spotifyTracks.length;

    // Process in concurrent batches
    for (let i = 0; i < total; i += CONCURRENCY_LIMIT) {
      const batch = spotifyTracks.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map((track) => this.resolveOne(track))
      );
      results.push(...batchResults);

      onProgress?.(Math.min(i + CONCURRENCY_LIMIT, total), total);

      // Small delay between batches to be polite to InnerTube
      if (i + CONCURRENCY_LIMIT < total) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    const matched = results.filter((r) => r.youtubeTrack !== null).length;
    console.log(
      `[ISRCResolver] Batch complete: ${matched}/${total} matched (${((matched / total) * 100).toFixed(1)}%)`
    );

    return results;
  }

  // ── Match Ranking ───────────────────────────────────────────────────────────

  private static pickBestMatch(
    candidates: YouTubeTrack[],
    targetTitle: string,
    targetArtist: string
  ): { track: YouTubeTrack; confidence: number } | null {
    if (candidates.length === 0) return null;

    const normalTitle = this.normalize(targetTitle);
    const normalArtist = this.normalize(targetArtist);

    let bestTrack = candidates[0];
    let bestScore = 0;

    for (const candidate of candidates) {
      const candTitle = this.normalize(candidate.title || '');
      const candArtist = this.normalize(candidate.artist || '');

      // Weighted composite score:
      //   60% title similarity + 40% artist similarity
      const titleScore = this.similarity(normalTitle, candTitle);
      const artistScore = this.similarity(normalArtist, candArtist);
      const compositeScore = titleScore * 0.6 + artistScore * 0.4;

      if (compositeScore > bestScore) {
        bestScore = compositeScore;
        bestTrack = candidate;
      }
    }

    return { track: bestTrack, confidence: bestScore };
  }

  // ── String Utilities ────────────────────────────────────────────────────────

  /** Normalizes text for comparison: lowercase, strip non-alphanumeric, trim. */
  private static normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Levenshtein-based similarity (0.0 – 1.0).
   * More efficient than full Levenshtein for long strings — uses bigram overlap.
   */
  private static similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // Bigram overlap (Sørensen–Dice coefficient)
    const bigramsA = this.getBigrams(a);
    const bigramsB = this.getBigrams(b);

    let intersection = 0;
    const bigramBSet = new Map<string, number>();
    for (const bg of bigramsB) {
      bigramBSet.set(bg, (bigramBSet.get(bg) || 0) + 1);
    }

    for (const bg of bigramsA) {
      const count = bigramBSet.get(bg);
      if (count && count > 0) {
        intersection++;
        bigramBSet.set(bg, count - 1);
      }
    }

    return (2 * intersection) / (bigramsA.length + bigramsB.length);
  }

  private static getBigrams(text: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.push(text.substring(i, i + 2));
    }
    return bigrams;
  }
}
