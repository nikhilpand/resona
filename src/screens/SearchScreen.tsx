import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  FlatList,
  Pressable,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Search as SearchIcon, X, Play, Radio, FileText, Music } from 'lucide-react-native';
import { Theme, PantoneColors } from '../theme/colors';
import { Typography } from '../theme/typography';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeStore } from '../stores/useThemeStore';
import { InnerTubeClient, YouTubeTrack } from '../services/youtube/InnerTubeClient';
import { LyricSearch, LyricSearchResult } from '../services/lyrics/LyricSearch';

type SearchMode = 'tracks' | 'lyrics';

export const SearchScreen: React.FC = () => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('tracks');
  const [trackResults, setTrackResults] = useState<YouTubeTrack[]>([]);
  const [lyricResults, setLyricResults] = useState<LyricSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const palette = useThemeStore((s) => s.palette);
  const setQueue = usePlaybackStore((s) => s.setQueue);
  const playTrack = usePlaybackStore((s) => s.playTrack);

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (query.trim() === '') {
      setTrackResults([]);
      setLyricResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const debounce = setTimeout(async () => {
      try {
        if (mode === 'tracks') {
          const results = await InnerTubeClient.search(query);
          setTrackResults(results);
        } else {
          const results = await LyricSearch.search(query);
          setLyricResults(results);
        }
      } catch (err) {
        console.warn('[SearchScreen] Search error:', err);
      } finally {
        setLoading(false);
      }
    }, mode === 'lyrics' ? 300 : 600); // Lyric FTS is fast, less debounce needed

    return () => clearTimeout(debounce);
  }, [query, mode]);

  const handlePlayTrack = useCallback(async (track: YouTubeTrack) => {
    await setQueue([track]);
    await playTrack(0);
  }, [setQueue, playTrack]);

  const activeColor = palette.primary;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <Text style={[styles.subtitle, { color: activeColor + 'AA' }]}>
          YOUTUBE MUSIC · LYRICS RECALL
        </Text>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchBarWrapper, { borderColor: query.length > 0 ? activeColor + '50' : Theme.dark.border }]}>
        <SearchIcon color={query.length > 0 ? activeColor : Theme.dark.textMuted} size={20} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={mode === 'lyrics' ? 'Type a lyric fragment...' : 'Artists, songs, albums...'}
          placeholderTextColor={Theme.dark.textMuted}
          style={styles.input}
          keyboardAppearance="dark"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} style={styles.clearButton}>
            <X color={Theme.dark.text} size={18} />
          </Pressable>
        )}
      </View>

      {/* Mode Toggle Tabs */}
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeTab, mode === 'tracks' && { backgroundColor: activeColor + '22', borderColor: activeColor + '55' }]}
          onPress={() => setMode('tracks')}
        >
          <Music size={14} color={mode === 'tracks' ? activeColor : 'rgba(255,255,255,0.4)'} />
          <Text style={[styles.modeTabText, mode === 'tracks' && { color: activeColor }]}>
            Tracks
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeTab, mode === 'lyrics' && { backgroundColor: activeColor + '22', borderColor: activeColor + '55' }]}
          onPress={() => setMode('lyrics')}
        >
          <FileText size={14} color={mode === 'lyrics' ? activeColor : 'rgba(255,255,255,0.4)'} />
          <Text style={[styles.modeTabText, mode === 'lyrics' && { color: activeColor }]}>
            Lyric Recall
          </Text>
          {mode === 'lyrics' && (
            <View style={[styles.newBadge, { backgroundColor: activeColor }]}>
              <Text style={styles.newBadgeText}>NEW</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={activeColor} />
          <Text style={styles.loadingText}>
            {mode === 'lyrics' ? 'Searching lyrics...' : 'Searching music catalog...'}
          </Text>
        </View>
      ) : mode === 'tracks' ? (
        /* Track Results */
        trackResults.length > 0 ? (
          <FlatList
            data={trackResults}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <Pressable style={styles.resultCard} onPress={() => handlePlayTrack(item)}>
                <Image source={{ uri: item.artwork }} style={styles.resultArt} />
                <View style={styles.resultInfo}>
                  <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.resultArtist} numberOfLines={1}>
                    {item.artist}{item.album ? ` · ${item.album}` : ''}
                  </Text>
                </View>
                <View style={[styles.playBtn, { backgroundColor: activeColor + '22' }]}>
                  <Play color={activeColor} size={14} fill={activeColor} />
                </View>
              </Pressable>
            )}
          />
        ) : (
          <EmptyState
            query={query}
            mode="tracks"
            accentColor={activeColor}
          />
        )
      ) : (
        /* Lyric Recall Results */
        lyricResults.length > 0 ? (
          <FlatList
            data={lyricResults}
            keyExtractor={(item) => item.trackId}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.lyricCard}>
                {item.artwork ? (
                  <Image source={{ uri: item.artwork }} style={styles.resultArt} />
                ) : (
                  <View style={[styles.lyricArtPlaceholder, { backgroundColor: activeColor + '18' }]}>
                    <Music size={18} color={activeColor} />
                  </View>
                )}
                <View style={styles.resultInfo}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.title || item.trackId}
                  </Text>
                  <Text style={styles.resultArtist} numberOfLines={1}>
                    {item.artist || 'Unknown Artist'}
                  </Text>
                  {/* Matched lyric snippet */}
                  <Text style={[styles.lyricSnippet, { color: activeColor }]} numberOfLines={2}>
                    "{item.matchedLine}"
                  </Text>
                </View>
              </View>
            )}
          />
        ) : (
          <EmptyState
            query={query}
            mode="lyrics"
            accentColor={activeColor}
          />
        )
      )}
    </View>
  );
};

// ─── Empty State ──────────────────────────────────────────────────────────────
const EmptyState = ({
  query,
  mode,
  accentColor,
}: {
  query: string;
  mode: SearchMode;
  accentColor: string;
}) => (
  <View style={styles.center}>
    {mode === 'lyrics' ? (
      <FileText size={52} color={accentColor + '40'} />
    ) : (
      <Radio size={52} color={accentColor + '40'} />
    )}
    <Text style={styles.emptyTitle}>
      {query.length > 0
        ? mode === 'lyrics'
          ? 'No lyrics found'
          : 'No results found'
        : mode === 'lyrics'
        ? 'Lyric Recall'
        : 'Explore Music'}
    </Text>
    <Text style={styles.emptySub}>
      {query.length > 0
        ? mode === 'lyrics'
          ? 'Try a different lyric fragment. Only cached/downloaded tracks are searchable.'
          : 'Try different keywords or artist names.'
        : mode === 'lyrics'
        ? 'Type any lyric fragment to find which song it belongs to. Works on downloaded & cached tracks.'
        : 'Search millions of tracks from YouTube Music.'}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.dark.background,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.xxl,
    color: Theme.dark.text,
  },
  subtitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.xs,
    letterSpacing: 2,
    marginTop: 4,
  },
  searchBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 50,
    marginBottom: 14,
    gap: 10,
  },
  input: {
    flex: 1,
    color: Theme.dark.text,
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.base,
    height: '100%',
  },
  clearButton: { padding: 6 },
  // ── Mode tabs
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  modeTabText: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
  },
  newBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: 8,
    color: '#000',
    letterSpacing: 0.5,
  },
  // ── Lists
  listContent: {
    paddingBottom: 120,
    gap: 8,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.dark.surface,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.dark.border,
    gap: 12,
  },
  lyricCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Theme.dark.surface,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.dark.border,
    gap: 12,
  },
  resultArt: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: PantoneColors.deepNavy,
  },
  lyricArtPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  resultInfo: {
    flex: 1,
    gap: 3,
  },
  resultTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.base,
    color: Theme.dark.text,
  },
  resultArtist: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: Theme.dark.textMuted,
  },
  lyricSnippet: {
    fontFamily: Typography.fonts.body,
    fontStyle: 'italic',
    fontSize: Typography.sizes.xs,
    lineHeight: 17,
    marginTop: 4,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingBottom: 80,
  },
  loadingText: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.sm,
    color: Theme.dark.textMuted,
    marginTop: 8,
  },
  emptyTitle: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.lg,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.sm,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
