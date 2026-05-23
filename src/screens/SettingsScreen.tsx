import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Switch,
  useWindowDimensions,
} from 'react-native';
import {
  Settings,
  User,
  Music,
  RefreshCw,
  HardDrive,
  Trash2,
  Download,
  ChevronRight,
  CheckCircle,
  XCircle,
  Wifi,
  WifiOff,
  LogOut,
  Disc,
  Zap,
  CircleDot,
} from 'lucide-react-native';
import { Theme, PantoneColors } from '../theme/colors';
import { Typography } from '../theme/typography';
import { SpotifyAuth } from '../services/auth/SpotifyAuth';
import { SpotifyClient, SpotifyUserProfile } from '../services/spotify/SpotifyClient';
import { ISRCResolver, ResolvedTrack } from '../services/sync/ISRCResolver';
import { useDownloadStore, StorageStats } from '../stores/useDownloadStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { db } from '../db/client';
import { DOWNLOAD_QUALITY_OPTIONS, DownloadQuality } from '../config';

// ─── Settings Screen ──────────────────────────────────────────────────────────

export const SettingsScreen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { width: screenWidth } = useWindowDimensions();

  // ── Spotify State ───────────────────────────────────────────────────────────
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
  const [spotifyProfile, setSpotifyProfile] = useState<SpotifyUserProfile | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // ── Download State ──────────────────────────────────────────────────────────
  const quality = useDownloadStore((s) => s.quality);
  const setQuality = useDownloadStore((s) => s.setQuality);
  const downloads = useDownloadStore((s) => s.downloads);
  const clearCache = useDownloadStore((s) => s.clearCache);
  const loadDownloads = useDownloadStore((s) => s.loadDownloads);
  const getStorageStats = useDownloadStore((s) => s.getStorageStats);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    checkSpotifyStatus();
    loadStorageStats();
    loadDownloads();
    loadLastSyncTime();
  }, []);

  const checkSpotifyStatus = async () => {
    const loggedIn = await SpotifyAuth.isLoggedIn();
    setIsSpotifyConnected(loggedIn);
    if (loggedIn) {
      try {
        const profile = await SpotifyClient.getProfile();
        setSpotifyProfile(profile);
      } catch {
        // Profile fetch might fail, just show connected state
      }
    }
  };

  const loadStorageStats = async () => {
    const stats = await getStorageStats();
    setStorageStats(stats);
  };

  const loadLastSyncTime = async () => {
    try {
      const rows = await db.execute(
        "SELECT value FROM spotify_sync WHERE key = 'last_sync_at'"
      );
      if (rows.length > 0) {
        const ts = Number(rows[0].value);
        setLastSyncTime(new Date(ts).toLocaleString());
      }
    } catch {
      // No sync history yet
    }
  };

  // ── Spotify Connect ─────────────────────────────────────────────────────────

  const handleSpotifyConnect = async () => {
    setIsConnecting(true);
    try {
      const success = await SpotifyAuth.login();
      if (success) {
        setIsSpotifyConnected(true);
        const profile = await SpotifyClient.getProfile();
        setSpotifyProfile(profile);
        Alert.alert('Connected', `Signed in as ${profile.email}`);
      }
    } catch (err: any) {
      Alert.alert('Connection Failed', err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSpotifyDisconnect = async () => {
    Alert.alert('Disconnect Spotify', 'This will remove your Spotify credentials.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await SpotifyAuth.logout();
          setIsSpotifyConnected(false);
          setSpotifyProfile(null);
        },
      },
    ]);
  };

  // ── Spotify Sync ────────────────────────────────────────────────────────────

  const handleSyncNow = async () => {
    if (!isSpotifyConnected) {
      Alert.alert('Not Connected', 'Connect your Spotify account first.');
      return;
    }

    setIsSyncing(true);
    try {
      // Step 1: Fetch liked tracks
      setSyncProgress('Fetching your Spotify library...');
      const spotifyTracks = await SpotifyClient.getLikedTracks();

      // Step 2: Cross-reference with YouTube via ISRC
      setSyncProgress(`Matching ${spotifyTracks.length} tracks to YouTube...`);
      const resolved = await ISRCResolver.resolveMany(spotifyTracks, (done, total) => {
        setSyncProgress(`Matching tracks: ${done}/${total}`);
      });

      // Step 3: Save matched tracks to SQLite
      const matched = resolved.filter((r) => r.youtubeTrack !== null);
      setSyncProgress(`Saving ${matched.length} matched tracks...`);

      for (const item of matched) {
        const yt = item.youtubeTrack!;
        const sp = item.spotifyTrack;
        await db.run(
          `INSERT INTO tracks (id, title, artist, album, artwork, duration, isrc, spotifyId, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'spotify')
           ON CONFLICT(id) DO UPDATE SET
             isrc = excluded.isrc,
             spotifyId = excluded.spotifyId,
             source = 'spotify'`,
          [yt.videoId, sp.title, sp.artist, sp.album, sp.artwork, sp.duration, sp.isrc, sp.spotifyId]
        );
      }

      // Step 4: Fetch audio features for matched tracks
      const spotifyIds = matched
        .map((m) => m.spotifyTrack.spotifyId)
        .filter(Boolean);
      if (spotifyIds.length > 0) {
        setSyncProgress('Fetching audio features...');
        const features = await SpotifyClient.getAudioFeatures(spotifyIds);
        for (const f of features) {
          await db.run(
            `UPDATE tracks SET valence = ?, energy = ?, tempo = ?, acousticness = ?
             WHERE spotifyId = ?`,
            [f.valence, f.energy, f.tempo, f.acousticness, f.spotifyId]
          );
        }
      }

      // Step 5: Record sync timestamp
      const now = Date.now();
      await db.run(
        `INSERT OR REPLACE INTO spotify_sync (key, value, updatedAt)
         VALUES ('last_sync_at', ?, ?)`,
        [now.toString(), now]
      );

      const unmatched = resolved.filter((r) => r.youtubeTrack === null).length;
      setLastSyncTime(new Date(now).toLocaleString());
      setSyncProgress('');

      Alert.alert(
        'Sync Complete',
        `Matched ${matched.length} tracks.\n${unmatched} tracks could not be matched.`
      );
    } catch (err: any) {
      console.error('[SettingsScreen] Sync error:', err);
      Alert.alert('Sync Failed', err.message);
      setSyncProgress('');
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Cache Clear ─────────────────────────────────────────────────────────────

  const handleClearCache = () => {
    Alert.alert(
      'Clear All Downloads',
      'This will delete all downloaded audio and lyrics. Streamed playback will still work.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            await clearCache();
            await loadStorageStats();
            setIsClearing(false);
            Alert.alert('Done', 'All downloads cleared.');
          },
        },
      ]
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const completedCount = downloads.filter((d) => d.status === 'complete').length;
  const activeCount = downloads.filter(
    (d) => d.status === 'pending' || d.status === 'downloading' || d.status === 'transcoding'
  ).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Settings color={PantoneColors.mediumSlate} size={22} />
          <Text style={styles.headerTitle}>Settings</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Spotify Account Section ──────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SPOTIFY ACCOUNT</Text>
          <View style={styles.card}>
            {isSpotifyConnected ? (
              <>
                <View style={styles.accountRow}>
                  <View style={[styles.statusDot, styles.statusConnected]} />
                  <View style={styles.accountInfo}>
                    <Text style={styles.accountName}>
                      {spotifyProfile?.displayName || 'Spotify User'}
                    </Text>
                    <Text style={styles.accountEmail}>
                      {spotifyProfile?.email || 'Connected'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={handleSpotifyDisconnect}
                    style={styles.disconnectButton}
                  >
                    <LogOut color={PantoneColors.fiesta} size={18} />
                  </Pressable>
                </View>

                {/* Sync Row */}
                <View style={styles.divider} />
                <Pressable
                  onPress={handleSyncNow}
                  disabled={isSyncing}
                  style={[styles.actionRow, isSyncing && styles.actionRowDisabled]}
                >
                  <RefreshCw
                    color={isSyncing ? PantoneColors.paleViolet : PantoneColors.mediumSlate}
                    size={18}
                  />
                  <View style={styles.actionTextCol}>
                    <Text style={styles.actionLabel}>
                      {isSyncing ? 'Syncing...' : 'Sync Now'}
                    </Text>
                    {syncProgress ? (
                      <Text style={styles.actionSubtext}>{syncProgress}</Text>
                    ) : lastSyncTime ? (
                      <Text style={styles.actionSubtext}>Last synced: {lastSyncTime}</Text>
                    ) : (
                      <Text style={styles.actionSubtext}>Import your Spotify library</Text>
                    )}
                  </View>
                  {isSyncing && (
                    <ActivityIndicator color={PantoneColors.mediumSlate} size="small" />
                  )}
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={handleSpotifyConnect}
                disabled={isConnecting}
                style={styles.connectButton}
              >
                {isConnecting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Disc color="#1DB954" size={22} />
                    <Text style={styles.connectText}>Connect Spotify</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </View>

        {/* ── Download Quality Section ─────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>DOWNLOAD QUALITY</Text>
          <View style={styles.card}>
            {DOWNLOAD_QUALITY_OPTIONS.map((option, index) => (
              <React.Fragment key={option.key}>
                {index > 0 && <View style={styles.divider} />}
                <Pressable
                  style={styles.qualityRow}
                  onPress={() => setQuality(option.key)}
                >
                  <View style={styles.qualityInfo}>
                    <Text style={styles.qualityLabel}>{option.label}</Text>
                    <Text style={styles.qualityDetail}>{option.detail}</Text>
                  </View>
                  <View
                    style={[
                      styles.radioOuter,
                      quality === option.key && styles.radioOuterActive,
                    ]}
                  >
                    {quality === option.key && <View style={styles.radioInner} />}
                  </View>
                </Pressable>
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* ── Storage & Downloads Section ──────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>STORAGE & DOWNLOADS</Text>
          <View style={styles.card}>
            {/* Stats Row */}
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Download color={PantoneColors.greenery} size={18} />
                <Text style={styles.statValue}>{completedCount}</Text>
                <Text style={styles.statLabel}>Downloaded</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <HardDrive color={PantoneColors.mediumSlate} size={18} />
                <Text style={styles.statValue}>
                  {storageStats ? formatBytes(storageStats.totalCachedBytes) : '...'}
                </Text>
                <Text style={styles.statLabel}>Used</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Zap color={PantoneColors.paleViolet} size={18} />
                <Text style={styles.statValue}>
                  {storageStats ? formatBytes(storageStats.availableDiskBytes) : '...'}
                </Text>
                <Text style={styles.statLabel}>Available</Text>
              </View>
            </View>

            {/* Active Downloads */}
            {activeCount > 0 && (
              <>
                <View style={styles.divider} />
                <View style={styles.actionRow}>
                  <ActivityIndicator color={PantoneColors.mediumSlate} size="small" />
                  <Text style={styles.actionLabel}>
                    {activeCount} download{activeCount > 1 ? 's' : ''} in progress
                  </Text>
                </View>
              </>
            )}

            {/* Clear Cache */}
            <View style={styles.divider} />
            <Pressable
              onPress={handleClearCache}
              disabled={isClearing}
              style={styles.destructiveRow}
            >
              <Trash2 color={PantoneColors.fiesta} size={18} />
              <Text style={styles.destructiveText}>
                {isClearing ? 'Clearing...' : 'Clear All Downloads'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* ── App Info ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ABOUT</Text>
          <View style={styles.card}>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>1.0.0-beta</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Build</Text>
              <Text style={styles.aboutValue}>Phase 4</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.dark.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.xl,
    color: '#ffffff',
  },
  closeButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  closeText: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: Typography.sizes.sm,
    color: PantoneColors.mediumSlate,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },

  // ── Section ─────────────────────────────────────────────────────────────
  section: {
    marginBottom: 28,
  },
  sectionLabel: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: 11,
    color: PantoneColors.paleViolet,
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: Theme.dark.card,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: 16,
  },

  // ── Account ─────────────────────────────────────────────────────────────
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusConnected: {
    backgroundColor: '#1DB954', // Spotify green
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.md,
    color: '#ffffff',
  },
  accountEmail: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: PantoneColors.paleViolet,
    marginTop: 2,
  },
  disconnectButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,79,55,0.1)',
  },

  // ── Connect ─────────────────────────────────────────────────────────────
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 18,
  },
  connectText: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.md,
    color: '#1DB954',
  },

  // ── Action Row ──────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  actionRowDisabled: {
    opacity: 0.6,
  },
  actionTextCol: {
    flex: 1,
  },
  actionLabel: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: Typography.sizes.md,
    color: '#ffffff',
  },
  actionSubtext: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: PantoneColors.paleViolet,
    marginTop: 2,
  },

  // ── Quality Radio ───────────────────────────────────────────────────────
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    justifyContent: 'space-between',
  },
  qualityInfo: {
    flex: 1,
  },
  qualityLabel: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: Typography.sizes.md,
    color: '#ffffff',
  },
  qualityDetail: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: PantoneColors.paleViolet,
    marginTop: 2,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: PantoneColors.mediumSlate,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PantoneColors.mediumSlate,
  },

  // ── Stats Grid ──────────────────────────────────────────────────────────
  statsGrid: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.lg,
    color: '#ffffff',
  },
  statLabel: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: PantoneColors.paleViolet,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  // ── Destructive ─────────────────────────────────────────────────────────
  destructiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  destructiveText: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: Typography.sizes.md,
    color: PantoneColors.fiesta,
  },

  // ── About ───────────────────────────────────────────────────────────────
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  aboutLabel: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.md,
    color: PantoneColors.paleViolet,
  },
  aboutValue: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: Typography.sizes.md,
    color: '#ffffff',
  },
});
