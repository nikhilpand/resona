export interface WordHighlight {
  word: string;
  startMs: number;
  endMs: number;
}

export interface LyricLine {
  timeMs: number;
  text: string;
  words?: WordHighlight[];
}

export class LrcParser {
  /**
   * Parses time strings in formats like [mm:ss.xx] or [mm:ss.xxx] into milliseconds.
   */
  private static parseTimeToMs(timeStr: string): number {
    const match = timeStr.match(/(\d{2}):(\d{2})[.:](\d{2,3})/);
    if (!match) return 0;
    
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    let msPart = match[3];
    
    // Normalize milliseconds (xx vs xxx)
    if (msPart.length === 2) {
      msPart += '0';
    }
    const milliseconds = parseInt(msPart, 10);
    
    return (minutes * 60 + seconds) * 1000 + milliseconds;
  }

  /**
   * Main parsing loop for LRC content.
   */
  public static parse(lrcContent: string): LyricLine[] {
    const lines = lrcContent.split(/\r?\n/);
    const result: LyricLine[] = [];

    // Match lines starting with one or more standard timestamps like [01:23.45][02:34.56]
    const lineRegex = /^((?:\[\d{2}:\d{2}[.:]\d{2,3}\])+)(.*)/;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(lineRegex);
      
      if (!match) continue; // Skip metadata tags like [ar:Artist], [ti:Title]
      
      // Extract individual time strings, e.g. ["01:23.45", "02:34.56"]
      const timeStrs = match[1].slice(1, -1).split('][');
      const rest = match[2].trim();

      // Check for enhanced word-level LRC tags: <00:12.30> Word
      const wordTagRegex = /<(\d{2}:\d{2}[.:]\d{2,3})>([^<]*)/g;
      const wordMatches = [...rest.matchAll(wordTagRegex)];

      for (const timeStr of timeStrs) {
        const timeMs = this.parseTimeToMs(timeStr);

        if (wordMatches.length > 0) {
          const words: WordHighlight[] = [];
          let cleanText = '';

          for (let i = 0; i < wordMatches.length; i++) {
            const currentMatch = wordMatches[i];
            const startMs = this.parseTimeToMs(currentMatch[1]);
            const word = currentMatch[2].trim();
            
            cleanText += (i === 0 ? '' : ' ') + word;

            // Determine end time of the word
            let endMs = startMs + 500;
            if (i + 1 < wordMatches.length) {
              endMs = this.parseTimeToMs(wordMatches[i + 1][1]);
            }

            if (word.length > 0) {
              words.push({ word, startMs, endMs });
            }
          }

          result.push({
            timeMs,
            text: cleanText,
            words,
          });
        } else {
          // Simple line-level lyrics
          result.push({
            timeMs,
            text: rest,
          });
        }
      }
    }

    // Sort by timestamp just in case they are out of order
    return result.sort((a, b) => a.timeMs - b.timeMs);
  }
}
