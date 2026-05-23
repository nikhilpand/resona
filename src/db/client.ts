import * as SQLite from 'expo-sqlite';

class DBClient {
  private dbInstance: SQLite.SQLiteDatabase | null = null;

  /**
   * Returns the open database instance, initializing it if necessary.
   */
  public async getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (!this.dbInstance) {
      this.dbInstance = await SQLite.openDatabaseAsync('vivi_music.db');
      await this.initializeSchema();
    }
    return this.dbInstance;
  }

  /**
   * Initializes the database schema tables if they do not exist.
   */
  private async initializeSchema(): Promise<void> {
    const database = this.dbInstance;
    if (!database) return;

    await database.execAsync(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        artwork TEXT,
        duration REAL NOT NULL,
        streamUrl TEXT,
        urlExpiry INTEGER,
        lyrics TEXT,
        -- Spotify cross-reference fields (Phase 4)
        isrc TEXT,
        spotifyId TEXT,
        valence REAL,
        energy REAL,
        tempo REAL,
        acousticness REAL,
        source TEXT DEFAULT 'youtube'
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlistId TEXT,
        trackId TEXT,
        position INTEGER DEFAULT 0,
        PRIMARY KEY (playlistId, trackId),
        FOREIGN KEY (playlistId) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (trackId) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS playback_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trackId TEXT NOT NULL,
        playedAt INTEGER NOT NULL,
        FOREIGN KEY (trackId) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cached_lyrics (
        trackId TEXT PRIMARY KEY,
        lyricsJson TEXT NOT NULL,
        plainText TEXT,
        source TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      -- FTS4 virtual table for lyric recall search ("find song by lyric")
      CREATE VIRTUAL TABLE IF NOT EXISTS lyrics_fts
        USING fts4(
          trackId,
          plainText,
          content="cached_lyrics"
        );

      -- Spotify sync status (Phase 4)
      CREATE TABLE IF NOT EXISTS spotify_sync (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      -- Download queue & offline cache (Phase 4)
      CREATE TABLE IF NOT EXISTS downloads (
        trackId TEXT PRIMARY KEY,
        quality TEXT NOT NULL DEFAULT 'high',
        status TEXT NOT NULL DEFAULT 'pending',
        progress REAL DEFAULT 0,
        filePath TEXT,
        fileSize INTEGER,
        lyricsOffline INTEGER DEFAULT 0,
        startedAt INTEGER,
        completedAt INTEGER,
        error TEXT,
        FOREIGN KEY (trackId) REFERENCES tracks(id) ON DELETE CASCADE
      );
    `);
    console.log('[DBClient] Database tables initialized successfully.');
  }

  /**
   * Executes a query that returns multiple rows.
   */
  public async execute(sql: string, params: any[] = []): Promise<any[]> {
    const database = await this.getDatabase();
    const result = await database.getAllAsync(sql, params);
    return result;
  }

  /**
   * Executes a single write statement (INSERT, UPDATE, DELETE).
   */
  public async run(sql: string, params: any[] = []): Promise<void> {
    const database = await this.getDatabase();
    await database.runAsync(sql, params);
  }

  /**
   * Executes multiple queries within a single ACID transaction.
   */
  public async runTransaction(queries: { sql: string; params: any[] }[]): Promise<void> {
    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      for (const query of queries) {
        await database.runAsync(query.sql, query.params);
      }
    });
  }
}

export const db = new DBClient();
