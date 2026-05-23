import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { FolderHeart, Plus, DownloadCloud, Radio, Disc } from 'lucide-react-native';
import { Theme, PantoneColors } from '../theme/colors';
import { Typography } from '../theme/typography';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { db } from '../db/client';
import { InnerTubeClient } from '../services/youtube/InnerTubeClient';

interface PlaylistItem {
  id: string;
  name: string;
  count: number;
  color: string;
}

export const LibraryScreen: React.FC = () => {
  const setQueue = usePlaybackStore((state) => state.setQueue);
  const playTrack = usePlaybackStore((state) => state.playTrack);

  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const loadPlaylists = async () => {
    try {
      const rows = await db.execute('SELECT * FROM playlists ORDER BY createdAt DESC');
      
      // If table is empty, seed it with default popular public playlists
      if (rows.length === 0) {
        console.log('[LibraryScreen] Seeding default playlists...');
        await db.run('INSERT INTO playlists (id, name, createdAt) VALUES (?, ?, ?)', [
          'PLofht4PTc2yOH5-pA_H80-O9U8D0P0kLO', // Lofi Hip Hop Focus
          'Lofi Hip Hop Focus',
          Date.now() - 1000,
        ]);
        await db.run('INSERT INTO playlists (id, name, createdAt) VALUES (?, ?, ?)', [
          'PL6F400F48D6C64188', // Classical Study Music
          'Classical Study Music',
          Date.now(),
        ]);
        
        const seededRows = await db.execute('SELECT * FROM playlists ORDER BY createdAt DESC');
        await mapAndSetPlaylists(seededRows);
      } else {
        await mapAndSetPlaylists(rows);
      }
    } catch (err) {
      console.warn('[LibraryScreen] Failed to load playlists:', err);
    }
  };

  const mapAndSetPlaylists = async (rows: any[]) => {
    const list = [];
    const colors = [
      PantoneColors.mediumSlate, 
      PantoneColors.ultraViolet, 
      PantoneColors.greenery, 
      PantoneColors.crystalBlue, 
      PantoneColors.paleViolet
    ];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const countRow = await db.execute('SELECT COUNT(*) as cnt FROM playlist_tracks WHERE playlistId = ?', [r.id]);
        list.push({
          id: r.id,
          name: r.name,
          count: countRow[0]?.cnt || 0,
          color: colors[i % colors.length],
        });
      } catch (err) {
        list.push({
          id: r.id,
          name: r.name,
          count: 0,
          color: colors[i % colors.length],
        });
      }
    }
    setPlaylists(list);
  };

  useEffect(() => {
    loadPlaylists();
  }, []);

  const handleImportPlaylist = async () => {
    if (!importUrl.trim()) return;
    
    let playlistId = importUrl.trim();
    // Extract playlist ID from URL query string if present
    const listMatch = playlistId.match(/[&?]list=([^&]+)/);
    if (listMatch) {
      playlistId = listMatch[1];
    }
    
    setIsImporting(true);
    try {
      console.log(`[LibraryScreen] Importing playlist ID: ${playlistId}...`);
      const tracks = await InnerTubeClient.fetchPlaylist(playlistId);
      if (tracks.length === 0) {
        Alert.alert('Import Failed', 'No tracks found or invalid playlist ID.');
        setIsImporting(false);
        return;
      }

      // 1. Insert playlist info into database
      const playlistName = `YT Playlist: ${playlistId.slice(0, 8)}`;
      await db.run(
        'INSERT OR REPLACE INTO playlists (id, name, createdAt) VALUES (?, ?, ?)',
        [playlistId, playlistName, Date.now()]
      );

      // 2. Batch sync tracks and bindings
      const queries = [];
      for (const track of tracks) {
        queries.push({
          sql: `INSERT OR IGNORE INTO tracks (id, title, artist, album, artwork, duration) 
                VALUES (?, ?, ?, ?, ?, ?)`,
          params: [
            track.videoId,
            track.title || 'Unknown Title',
            track.artist || 'Unknown Artist',
            track.album || '',
            track.artwork || '',
            track.duration || 0,
          ],
        });
        queries.push({
          sql: `INSERT OR REPLACE INTO playlist_tracks (playlistId, trackId) 
                VALUES (?, ?)`,
          params: [playlistId, track.videoId],
        });
      }
      
      await db.runTransaction(queries);
      
      // 3. Reload layouts & clear state
      await loadPlaylists();
      setImportUrl('');
      
      // 4. Play tracks instantly
      await setQueue(tracks);
      await playTrack(0);
      
      Alert.alert('Sync Complete', `Imported ${tracks.length} tracks.`);
    } catch (err: any) {
      console.error(err);
      Alert.alert('Import Error', `Playlist sync failed: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handlePlayPlaylist = async (playlist: any) => {
    setIsImporting(true);
    try {
      // 1. Check if tracks are already cached in local SQLite DB
      const rows = await db.execute(
        `SELECT tracks.* FROM tracks 
         INNER JOIN playlist_tracks ON tracks.id = playlist_tracks.trackId 
         WHERE playlist_tracks.playlistId = ?`,
        [playlist.id]
      );

      if (rows.length > 0) {
        const tracks = rows.map((r) => ({
          id: r.id,
          videoId: r.id,
          url: '', // Default placeholder
          title: r.title,
          artist: r.artist,
          album: r.album || '',
          artwork: r.artwork || '',
          duration: r.duration || 0,
        }));
        await setQueue(tracks);
        await playTrack(0);
      } else {
        // Cache miss: Crawl playlist from InnerTube
        console.log(`[LibraryScreen] Cached tracks missing. Crawling playlist ${playlist.id}...`);
        const tracks = await InnerTubeClient.fetchPlaylist(playlist.id);
        if (tracks.length === 0) {
          Alert.alert('Error', 'Could not retrieve tracks.');
          return;
        }

        // Cache tracks & relations
        const queries = [];
        for (const track of tracks) {
          queries.push({
            sql: `INSERT OR IGNORE INTO tracks (id, title, artist, album, artwork, duration) 
                  VALUES (?, ?, ?, ?, ?, ?)`,
            params: [
              track.videoId,
              track.title || 'Unknown Title',
              track.artist || 'Unknown Artist',
              track.album || '',
              track.artwork || '',
              track.duration || 0,
            ],
          });
          queries.push({
            sql: `INSERT OR REPLACE INTO playlist_tracks (playlistId, trackId) 
                  VALUES (?, ?)`,
            params: [playlist.id, track.videoId],
          });
        }
        await db.runTransaction(queries);
        
        await loadPlaylists(); // update counter
        await setQueue(tracks);
        await playTrack(0);
      }
    } catch (err: any) {
      console.error(err);
      Alert.alert('Error', `Failed to load playlist tracks: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Immersive Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Your Library</Text>
        <Text style={styles.subtitle}>OFFLINE & CLOUD SYNC</Text>
      </View>

      {/* Grid of quick shortcuts */}
      <View style={styles.shortcutGrid}>
        <Pressable style={styles.shortcutButton}>
          <FolderHeart color={PantoneColors.fiesta} size={24} />
          <Text style={styles.shortcutText}>Liked Songs</Text>
        </Pressable>
        <Pressable style={styles.shortcutButton}>
          <DownloadCloud color={PantoneColors.greenery} size={24} />
          <Text style={styles.shortcutText}>Downloads</Text>
        </Pressable>
      </View>

      {/* Import Playlist Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Import Cloud Playlist</Text>
        <View style={styles.importWrapper}>
          <TextInput
            value={importUrl}
            onChangeText={setImportUrl}
            placeholder="YouTube Playlist ID or URL..."
            placeholderTextColor={Theme.dark.textMuted}
            style={styles.importInput}
            keyboardAppearance="dark"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable 
            style={[styles.importButton, (isImporting || !importUrl.trim()) && styles.disabledButton]} 
            onPress={handleImportPlaylist}
            disabled={isImporting || !importUrl.trim()}
          >
            {isImporting ? (
              <ActivityIndicator size="small" color={Theme.dark.background} />
            ) : (
              <DownloadCloud color={Theme.dark.background} size={18} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Playlists Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Disc color={PantoneColors.paleViolet} size={18} />
          <Text style={styles.sectionTitle}>Playlists</Text>
        </View>

        {playlists.map((p) => (
          <Pressable 
            key={p.id} 
            style={styles.playlistRow}
            onPress={() => handlePlayPlaylist(p)}
          >
            <View style={[styles.playlistColorBlock, { backgroundColor: p.color + '30', borderColor: p.color }]} >
              <Radio color={p.color} size={20} />
            </View>
            <View style={styles.playlistDetails}>
              <Text style={styles.playlistName}>{p.name}</Text>
              <Text style={styles.playlistTracksCount}>{p.count} tracks</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.dark.background,
  },
  content: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 100,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.xxl,
    color: Theme.dark.text,
  },
  subtitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.xs,
    color: Theme.dark.textMuted,
    letterSpacing: 2,
    marginTop: 4,
  },
  shortcutGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  shortcutButton: {
    flex: 1,
    backgroundColor: Theme.dark.surface,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.dark.border,
    alignItems: 'center',
    gap: 8,
  },
  shortcutText: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: Typography.sizes.sm,
    color: Theme.dark.text,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.sm,
    color: Theme.dark.textMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.dark.surface,
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Theme.dark.border,
  },
  playlistColorBlock: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistDetails: {
    marginLeft: 14,
    flex: 1,
  },
  playlistName: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.base,
    color: Theme.dark.text,
  },
  playlistTracksCount: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: Theme.dark.textMuted,
    marginTop: 2,
  },
  importWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.dark.border,
    paddingHorizontal: 12,
    height: 48,
    marginTop: 4,
  },
  importInput: {
    flex: 1,
    color: Theme.dark.text,
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.sm,
    height: '100%',
  },
  importButton: {
    backgroundColor: PantoneColors.crystalBlue,
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
});
