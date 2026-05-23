import React, { useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LyricLine, WordHighlight } from '../../services/lyrics/LrcParser';
import { Typography } from '../../theme/typography';

interface SyncedLyricsListProps {
  lyrics: LyricLine[];
  activeIndex: number;
  /** Current playback position in milliseconds — used for word-level highlight */
  currentPositionMs: number;
  onLinePress: (timeMs: number) => void;
  onScrollBeginDrag: () => void;
  isLocked: boolean;
  /** Palette primary color — tints the active lyric highlight */
  accentColor?: string;
}

const LYRIC_ROW_HEIGHT = 72;

// ─── Word-Level Highlight Line ───────────────────────────────────────────────
const WordHighlightLine = React.memo(({
  words,
  currentPositionMs,
  accentColor,
}: {
  words: WordHighlight[];
  currentPositionMs: number;
  accentColor: string;
}) => {
  return (
    <View style={styles.wordRow}>
      {words.map((word, i) => {
        const isWordActive =
          currentPositionMs >= word.startMs && currentPositionMs < word.endMs;
        const isPastWord = currentPositionMs >= word.endMs;

        return (
          <Animated.Text
            key={`${word.word}-${i}`}
            style={[
              styles.wordText,
              isPastWord && { color: accentColor + 'CC', fontFamily: Typography.fonts.bodyBold },
              isWordActive && [
                styles.wordActive,
                {
                  color: accentColor,
                  textShadowColor: accentColor + '80',
                },
              ],
            ]}
          >
            {word.word}{i < words.length - 1 ? ' ' : ''}
          </Animated.Text>
        );
      })}
    </View>
  );
});

// ─── Single Lyric Line Item ───────────────────────────────────────────────────
const LyricLineItem = React.memo(({
  line,
  isActive,
  currentPositionMs,
  accentColor,
  onPress,
}: {
  line: LyricLine;
  isActive: boolean;
  currentPositionMs: number;
  accentColor: string;
  onPress: () => void;
}) => {
  const scaleValue = useSharedValue(isActive ? 1.04 : 1);
  const opacityValue = useSharedValue(isActive ? 1 : 0.3);

  useEffect(() => {
    scaleValue.value = withSpring(isActive ? 1.04 : 1, { damping: 14, stiffness: 180 });
    opacityValue.value = withTiming(isActive ? 1 : 0.3, { duration: 250 });
  }, [isActive]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }],
    opacity: opacityValue.value,
  }));

  const hasWords = line.words && line.words.length > 0;

  return (
    <Pressable style={styles.lineWrapper} onPress={onPress}>
      <Animated.View style={animatedStyle}>
        {isActive && hasWords ? (
          // Word-level karaoke highlight for active line
          <WordHighlightLine
            words={line.words!}
            currentPositionMs={currentPositionMs}
            accentColor={accentColor}
          />
        ) : (
          // Standard line text
          <Text
            numberOfLines={2}
            style={[
              styles.text,
              isActive
                ? [styles.textActive, { textShadowColor: accentColor + '60' }]
                : styles.textInactive,
            ]}
          >
            {line.text}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
});

// ─── Main Synced Lyrics List ──────────────────────────────────────────────────
export const SyncedLyricsList: React.FC<SyncedLyricsListProps> = ({
  lyrics,
  activeIndex,
  currentPositionMs,
  onLinePress,
  onScrollBeginDrag,
  isLocked,
  accentColor = '#7B68EE',
}) => {
  const flatListRef = useRef<FlatList<LyricLine>>(null);
  const { height: screenHeight } = useWindowDimensions();

  // Auto-scroll to active line when index changes (if user hasn't grabbed scroll)
  useEffect(() => {
    if (!isLocked && activeIndex >= 0 && activeIndex < lyrics.length) {
      flatListRef.current?.scrollToIndex({
        index: activeIndex,
        animated: true,
        viewPosition: 0.4, // Slightly above center for better visual balance
      });
    }
  }, [activeIndex, isLocked, lyrics.length]);

  return (
    <FlatList
      ref={flatListRef}
      data={lyrics}
      showsVerticalScrollIndicator={false}
      keyExtractor={(_, index) => index.toString()}
      onScrollBeginDrag={onScrollBeginDrag}
      getItemLayout={(_, index) => ({
        length: LYRIC_ROW_HEIGHT,
        offset: LYRIC_ROW_HEIGHT * index,
        index,
      })}
      contentContainerStyle={[
        styles.listContainer,
        {
          paddingTop: screenHeight / 2 - LYRIC_ROW_HEIGHT / 2,
          paddingBottom: screenHeight / 2 - LYRIC_ROW_HEIGHT / 2,
        },
      ]}
      initialNumToRender={15}
      maxToRenderPerBatch={10}
      windowSize={7}
      renderItem={({ item, index }) => {
        const isActive = index === activeIndex;
        return (
          <LyricLineItem
            line={item}
            isActive={isActive}
            currentPositionMs={currentPositionMs}
            accentColor={accentColor}
            onPress={() => onLinePress(item.timeMs)}
          />
        );
      }}
    />
  );
};

const styles = StyleSheet.create({
  listContainer: {
    alignItems: 'center',
  },
  lineWrapper: {
    minHeight: LYRIC_ROW_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  // Plain line text styles
  text: {
    fontSize: Typography.sizes.lg,
    textAlign: 'center',
    lineHeight: 28,
  },
  textActive: {
    fontFamily: Typography.fonts.display,
    color: '#ffffff',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  textInactive: {
    fontFamily: Typography.fonts.bodyMedium,
    color: 'rgba(255,255,255,0.28)',
  },
  // Word-level highlight styles
  wordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wordText: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.lg,
    color: 'rgba(255,255,255,0.28)',
    lineHeight: 32,
  },
  wordActive: {
    fontFamily: Typography.fonts.display,
    fontSize: Typography.sizes.xl,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
});
