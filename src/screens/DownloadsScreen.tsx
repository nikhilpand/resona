import React, { useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Pressable,
  Image,
  Alert,
} from 'react-native';
import {
  Download,
  X,
  CheckCircle,
  AlertCircle,
  Clock,
  Trash2,
  HardDrive,
  Music,
} from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { Theme, PantoneColors } from '../theme/colors';
import { Typography } from '../theme/typography';
import { useDownloadStore, DownloadEntry } from '../stores/useDownloadStore';
import { useThemeStore } from '../stores/useThemeStore';

interface DownloadsScreenProps {
  onClose?: () => void;
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
const DownloadProgressBar = React.memo(({
  progress,
  color,
  status,
}: {
  progress: number;
  color: string;
  status: string;
}) => {
  const animatedWidth = useSharedValue(0);

  useEffect(() => {
    animatedWidth.value = withTiming(progress * 100, { duration: 400 });
  }, [progress]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${animatedWidth.value}%`,
  }));

  const isComplete = status === 'completed';
  const hasError = status === 'error';
  const barColor = hasError
    ? PantoneColors.fiesta
    : isComplete
    ? PantoneColors.greenery
    : color;

  return (
    <View style={styles.progressTrack}>
      <Animated.View
        style={[
          styles.progressFill,
          { backgroundColor: barColor },
          barStyle,
        ]}
      />
    </View>
  );
});

// ─── Download Item Card ───────────────────────────────────────────────────────
const DownloadItem = React.memo(({
  entry,
  accentColor,
  onCancel,
  onRemove,
}: {
  entry: DownloadEntry;
  accentColor: string;
  onCancel: () => void;
  onRemove: () => void;
}) => {
  const STATUS_ICONS: Record<string, React.ReactNode> = {
    pending: <Clock size={14} color={PantoneColors.paleViolet} />,
    downloading: <Download size={14} color={accentColor} />,
    completed: <CheckCircle size={14} color={PantoneColors.greenery} />,
    error: <AlertCircle size={14} color={PantoneColors.fiesta} />,
    cancelled: <X size={14} color="rgba(255,255,255,0.3)" />,
  };

  const STATUS_LABELS: Record<string, string> = {
    pending: 'Queued',
    downloading: `${Math.round(entry.progress * 100)}%`,
    completed: 'Downloaded',
    error: 'Failed',
    cancelled: 'Cancelled',
  };

  const qualityLabel =
    entry.quality === 'lossless'
      ? 'FLAC'
      : entry.quality === 'high'
      ? '320k MP3'
      : '128k AAC';

  const fileSizeMB = entry.fileSize ? (entry.fileSize / (1024 * 1024)).toFixed(1) : null;

  return (
    <View style={styles.itemCard}>
      {/* Album Art */}
      <View style={styles.itemArtContainer}>
        {entry.artwork ? (
          <Image source={{ uri: entry.artwork }} style={styles.itemArt} />
        ) : (
          <View style={[styles.itemArtPlaceholder, { backgroundColor: accentColor + '20' }]}>
            <Music size={16} color={accentColor} />
          </View>
        )}
        {/* Lyrics badge */}
        {entry.lyricsOffline && (
          <View style={[styles.lyricsBadge, { backgroundColor: accentColor }]}>
            <Text style={styles.lyricsBadgeText}>L</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.itemInfo}>
        <Text style={styles.itemTitle} numberOfLines={1}>{entry.title || entry.trackId}</Text>
        <Text style={styles.itemArtist} numberOfLines={1}>{entry.artist || 'Unknown Artist'}</Text>

        {/* Progress bar (only for active/failed states) */}
        {(entry.status === 'downloading' || entry.status === 'completed' || entry.status === 'error') && (
          <View style={styles.progressContainer}>
            <DownloadProgressBar
              progress={entry.status === 'completed' ? 1 : entry.progress}
              color={accentColor}
              status={entry.status}
            />
          </View>
        )}

        {/* Status row */}
        <View style={styles.statusRow}>
          {STATUS_ICONS[entry.status]}
          <Text style={[
            styles.statusText,
            entry.status === 'completed' && { color: PantoneColors.greenery },
            entry.status === 'error' && { color: PantoneColors.fiesta },
          ]}>
            {STATUS_LABELS[entry.status]}
          </Text>
          <Text style={styles.qualityTag}>{qualityLabel}</Text>
          {fileSizeMB && entry.status === 'completed' && (
            <Text style={styles.fileSizeText}>{fileSizeMB} MB</Text>
          )}
          {entry.lyricsOffline && (
            <Text style={[styles.qualityTag, { color: accentColor }]}>+ Lyrics</Text>
          )}
        </View>
      </View>

      {/* Action Button */}
      <Pressable
        style={styles.itemAction}
        onPress={entry.status === 'downloading' || entry.status === 'pending' ? onCancel : onRemove}
      >
        {entry.status === 'downloading' || entry.status === 'pending'
          ? <X size={16} color="rgba(255,255,255,0.5)" />
          : <Trash2 size={16} color="rgba(255,255,255,0.3)" />
        }
      </Pressable>
    </View>
  );
});

// ─── Downloads Screen ─────────────────────────────────────────────────────────
export const DownloadsScreen: React.FC<DownloadsScreenProps> = ({ onClose }) => {
  const palette = useThemeStore((s) => s.palette);
  const downloads = useDownloadStore((s) => s.downloads);
  const cancelDownload = useDownloadStore((s) => s.cancelDownload);
  const removeDownload = useDownloadStore((s) => s.removeDownload);
  const storageStats = useDownloadStore((s) => s.storageStats);
  const refreshStats = useDownloadStore((s) => s.refreshStats);

  useEffect(() => {
    refreshStats();
  }, []);

  const downloadList = Object.values(downloads);
  const activeCount = downloadList.filter((d) => d.status === 'downloading').length;
  const completedCount = downloadList.filter((d) => d.status === 'completed').length;

  const handleClearCompleted = () => {
    Alert.alert(
      'Clear Completed',
      'Remove all completed downloads from the list? Files on disk will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            downloadList
              .filter((d) => d.status === 'completed' || d.status === 'error' || d.status === 'cancelled')
              .forEach((d) => removeDownload(d.trackId));
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.backgroundTint }]}>
      {/* Background glow */}
      <View style={[styles.bgGlow, { backgroundColor: palette.glow }]} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Download size={20} color={palette.primary} />
          <Text style={[styles.headerTitle, { color: palette.primary }]}>DOWNLOADS</Text>
        </View>
        <View style={styles.headerRight}>
          {completedCount > 0 && (
            <Pressable onPress={handleClearCompleted} style={styles.clearButton}>
              <Text style={[styles.clearText, { color: palette.primary + 'CC' }]}>Clear done</Text>
            </Pressable>
          )}
          {onClose && (
            <Pressable onPress={onClose} style={styles.closeButton}>
              <X size={20} color="rgba(255,255,255,0.5)" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Storage Stats Bar */}
      <View style={[styles.statsBar, { borderColor: palette.primary + '20' }]}>
        <View style={styles.statItem}>
          <HardDrive size={14} color={palette.primary} />
          <Text style={styles.statValue}>{storageStats.cachedSizeMB.toFixed(0)} MB</Text>
          <Text style={styles.statLabel}>Used</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <CheckCircle size={14} color={PantoneColors.greenery} />
          <Text style={styles.statValue}>{completedCount}</Text>
          <Text style={styles.statLabel}>Saved</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Download size={14} color={palette.primary} />
          <Text style={styles.statValue}>{activeCount}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <HardDrive size={14} color="rgba(255,255,255,0.4)" />
          <Text style={styles.statValue}>{storageStats.availableMB.toFixed(0)} MB</Text>
          <Text style={styles.statLabel}>Free</Text>
        </View>
      </View>

      {/* Downloads List */}
      {downloadList.length === 0 ? (
        <View style={styles.emptyState}>
          <Download size={48} color={palette.primary + '40'} />
          <Text style={styles.emptyTitle}>No Downloads Yet</Text>
          <Text style={styles.emptySubtitle}>
            Long-press any track and tap "Download" to save it for offline listening.
          </Text>
        </View>
      ) : (
        <FlatList
          data={downloadList}
          keyExtractor={(item) => item.trackId}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <DownloadItem
              entry={item}
              accentColor={palette.primary}
              onCancel={() => cancelDownload(item.trackId)}
              onRemove={() => {
                Alert.alert(
                  'Remove Download',
                  `Remove "${item.title || item.trackId}" from your offline files?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => removeDownload(item.trackId),
                    },
                  ]
                );
              }}
            />
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bgGlow: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    opacity: 0.6,
  },
  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 2.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  clearText: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: 12,
  },
  closeButton: {
    padding: 4,
  },
  // ── Stats
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: Typography.fonts.monospace,
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '700',
  },
  statLabel: {
    fontFamily: Typography.fonts.body,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  // ── List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 8,
  },
  // ── Item Card
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 12,
  },
  itemArtContainer: {
    position: 'relative',
  },
  itemArt: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: PantoneColors.deepNavy,
  },
  itemArtPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lyricsBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lyricsBadgeText: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: 8,
    color: '#000',
  },
  itemInfo: {
    flex: 1,
    gap: 3,
  },
  itemTitle: {
    fontFamily: Typography.fonts.bodyBold,
    fontSize: Typography.sizes.sm,
    color: '#ffffff',
  },
  itemArtist: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.xs,
    color: 'rgba(255,255,255,0.5)',
  },
  progressContainer: {
    marginTop: 6,
    marginBottom: 2,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  statusText: {
    fontFamily: Typography.fonts.bodyMedium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  qualityTag: {
    fontFamily: Typography.fonts.monospace,
    fontSize: 9,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.3,
  },
  fileSizeText: {
    fontFamily: Typography.fonts.monospace,
    fontSize: 9,
    color: 'rgba(255,255,255,0.3)',
  },
  itemAction: {
    padding: 8,
  },
  // ── Empty State
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.lg,
    color: 'rgba(255,255,255,0.6)',
  },
  emptySubtitle: {
    fontFamily: Typography.fonts.body,
    fontSize: Typography.sizes.sm,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
