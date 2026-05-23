import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface AudioVisualizerProps {
  frequencies: number[];
  /** Optional palette-driven color — defaults to MediumSlate */
  color?: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ frequencies, color = '#7B68EE' }) => {
  const { width } = useWindowDimensions();
  const canvasHeight = 100;
  const numBars = frequencies.length;

  // Shared values holding target visualizer heights
  const sharedFrequencies = useSharedValue<number[]>(new Array(numBars).fill(0.05));

  useEffect(() => {
    sharedFrequencies.value = withTiming(frequencies, {
      duration: 100,
      easing: Easing.linear,
    });
  }, [frequencies]);

  // Compute the Skia path on the UI thread dynamically
  const animatedPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const barWidth = (width - 40) / numBars;
    const padding = 2;

    sharedFrequencies.value.forEach((val, i) => {
      const barHeight = Math.max(val * canvasHeight, 4);
      const x = i * barWidth;
      const y = canvasHeight - barHeight;

      path.addRRect(
        Skia.RRectXY(
          Skia.XYWHRect(x + padding / 2, y, barWidth - padding, barHeight),
          3,
          3
        )
      );
    });

    return path;
  });

  return (
    <Canvas style={[styles.canvas, { height: canvasHeight }]}>
      <Path
        path={animatedPath}
        color={color}
      />
    </Canvas>
  );
};

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    backgroundColor: 'transparent',
  },
});
