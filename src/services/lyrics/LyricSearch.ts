import { db } from '../../db/client';
import { LyricLine } from './LrcParser';

export interface LyricSearchResult {
  trackId: string;
  title?: string;
  artist?: string;
  artwork?: string;
  /** The matched lyric line text */
  matchedLine: string;
  /** Snippet of surrounding context */
  snippet: string;
}

/**
 * LyricSearch — FTS4-powered "find song by lyric" service.
 *
 * Uses SQLite FTS4 virtual table (lyrics_fts) to search plain-text
 * cached lyrics. On hit, joins with tracks table to return metadata.
 *
 * Indexing: call `indexLyrics` when saving lyrics to cache.
 * Searching: call `search` with a user query fragment.
 */
export class LyricSearch {
  /**
   * Indexes a set of lyrics for full-text search.
   * Should be called every time lyrics are saved to `cached_lyrics`.
   */
  public static async indexLyrics(
    trackId: string,
    lines: LyricLine[]
  ): Promise<void> {
    try {
      // Build plain-text blob — one line per row separated by newlines
      const plainText = lines.map((l) => l.text).join('\n');

      // Update the plainText column in cached_lyrics
      await db.run(
        `UPDATE cached_lyrics SET plainText = ? WHERE trackId = ?`,
        [plainText, trackId]
      );

      // Delete stale FTS entry if exists, then re-insert
      await db.run(`DELETE FROM lyrics_fts WHERE trackId = ?`, [trackId]);
      await db.run(
        `INSERT INTO lyrics_fts (trackId, plainText) VALUES (?, ?)`,
        [trackId, plainText]
      );
    } catch (err) {
      console.warn('[LyricSearch] Failed to index lyrics:', err);
    }
  }

  /**
   * Searches cached lyrics for a query fragment.
   * Returns up to 20 matching tracks with matched line context.
   */
  public static async search(query: string): Promise<LyricSearchResult[]> {
    if (!query || query.trim().length < 2) return [];

    try {
      const cleanQuery = query.trim().replace(/['"]/g, '');

      // FTS4 MATCH query — prefix search with *
      const ftsResults: Array<{ trackId: string; plainText: string }> =
        await db.execute(
          `SELECT trackId, plainText FROM lyrics_fts WHERE lyrics_fts MATCH ? LIMIT 20`,
          [`${cleanQuery}*`]
        );

      if (ftsResults.length === 0) return [];

      // Join with tracks table for metadata
      const trackIds = ftsResults.map((r) => r.trackId);
      const placeholders = trackIds.map(() => '?').join(', ');

      const tracks: Array<{
        id: string;
        title: string;
        artist: string;
        artwork: string;
      }> = await db.execute(
        `SELECT id, title, artist, artwork FROM tracks WHERE id IN (${placeholders})`,
        trackIds
      );

      const trackMap = new Map(tracks.map((t) => [t.id, t]));

      return ftsResults.map((ftsRow) => {
        const track = trackMap.get(ftsRow.trackId);
        const matchedLine = this.findMatchedLine(ftsRow.plainText, cleanQuery);

        return {
          trackId: ftsRow.trackId,
          title: track?.title,
          artist: track?.artist,
          artwork: track?.artwork,
          matchedLine,
          snippet: this.buildSnippet(ftsRow.plainText, cleanQuery),
        };
      });
    } catch (err) {
      console.warn('[LyricSearch] Search failed:', err);
      return [];
    }
  }

  /** Finds the specific line that contains the query. */
  private static findMatchedLine(plainText: string, query: string): string {
    const lines = plainText.split('\n');
    const lower = query.toLowerCase();
    return (
      lines.find((l) => l.toLowerCase().includes(lower)) || lines[0] || ''
    );
  }

  /** Returns a short snippet with 10 chars of context on each side. */
  private static buildSnippet(plainText: string, query: string): string {
    const lower = plainText.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return plainText.slice(0, 80);

    const start = Math.max(0, idx - 30);
    const end = Math.min(plainText.length, idx + query.length + 30);
    const snippet = plainText.slice(start, end);

    return (start > 0 ? '…' : '') + snippet + (end < plainText.length ? '…' : '');
  }
}
