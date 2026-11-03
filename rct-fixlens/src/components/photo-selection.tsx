import { useEffect, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { SegmentedControl } from "@expo/ui/community/segmented-control";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedProps,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { G, Path, Rect } from "react-native-svg";
import type { Photo, Selection, SelectionPoint } from "@/api/types";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  selectionFromStrokes,
  strokePath,
  type BrushStroke,
} from "@/lib/selection";
import { Action, Copy } from "@/components/fixlens-ui";
const AnimatedPath = Animated.createAnimatedComponent(Path);
const MAX_STROKES = 16;
const BRUSHES = [
  { label: "Fine", width: 14 },
  { label: "Medium", width: 28 },
  { label: "Wide", width: 44 },
];
const BRUSH_LABELS = BRUSHES.map(({ label }) => label);
export function PhotoSelection({
  photo,
  selection,
  onChange,
  strokes,
  onStrokesChange,
  disabled = false,
  reviewing = false,
  maskUrl,
  outlineUrl,
  showFill = true,
  onMaskReady,
  onMaskError,
}: {
  photo: Photo;
  selection: Selection | null;
  onChange: (selection: Selection | null) => void;
  strokes: BrushStroke[];
  onStrokesChange: (strokes: BrushStroke[]) => void;
  disabled?: boolean;
  reviewing?: boolean;
  maskUrl?: string | null;
  outlineUrl?: string | null;
  showFill?: boolean;
  onMaskReady?: () => void;
  onMaskError?: () => void;
}) {
  const theme = useTheme();
  const canDraw = !disabled && !reviewing;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [brush, setBrush] = useState(1);
  const brushWidth = BRUSHES[brush].width;
  const activePath = useSharedValue("");
  const activePoints = useSharedValue<SelectionPoint[]>([]);
  const activeRadius = useSharedValue(1);
  useEffect(() => {
    activePath.set("");
  }, [strokes, activePath]);
  function update(next: BrushStroke[]) {
    onStrokesChange(next);
    onChange(selectionFromStrokes(next, photo.width, photo.height));
  }
  function commit(points: SelectionPoint[], radius: number) {
    if (!points.length || strokes.length >= MAX_STROKES) return;
    update([...strokes, { points, radius }]);
  }
  function point(x: number, y: number) {
    "worklet";
    return {
      x: Math.max(0, Math.min(photo.width - 1, (x * photo.width) / size.width)),
      y: Math.max(
        0,
        Math.min(photo.height - 1, (y * photo.height) / size.height),
      ),
    };
  }
  const gesture = Gesture.Pan()
    .enabled(canDraw && size.width > 0 && strokes.length < MAX_STROKES)
    .minDistance(0)
    .maxPointers(1)
    .onBegin((event) => {
      const p = point(event.x, event.y);
      activeRadius.set(((brushWidth / 2) * photo.width) / size.width);
      activePoints.set([p]);
      activePath.set(`M${p.x},${p.y}L${p.x + 0.01},${p.y}`);
    })
    .onUpdate((event) => {
      const p = point(event.x, event.y),
        points = activePoints.get(),
        last = points[points.length - 1];
      if (
        points.length >= 1024 ||
        Math.hypot(p.x - last.x, p.y - last.y) < (photo.width / size.width) * 2
      )
        return;
      activePoints.set([...points, p]);
      activePath.set(activePath.get() + `L${p.x},${p.y}`);
    })
    .onEnd(() => {
      scheduleOnRN(commit, activePoints.get(), activeRadius.get());
    })
    .onFinalize((_event, success) => {
      if (!success) activePath.set("");
    });
  const animatedProps = useAnimatedProps(() => ({
    d: activePath.get(),
    strokeWidth: activeRadius.get() * 2,
  }));
  return (
    <View
      style={{
        width: "100%",
        padding: Spacing.one,
        borderRadius: Radius.large,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
      }}
    >
      {canDraw ? (
        <Copy
          variant="caption"
          muted
          style={{ paddingHorizontal: Spacing.two, paddingVertical: Spacing.two }}
        >
          Swipe along a crack, or brush across a stain or scuff. A rough mark is
          enough.
        </Copy>
      ) : null}
      <View
        style={{
          alignItems: "center",
          backgroundColor: theme.backgroundElement,
          borderRadius: Radius.medium,
          borderCurve: "continuous",
        }}
      >
        <GestureDetector gesture={gesture} touchAction="none">
          <View
            testID="photo-selection"
            accessibilityLabel="Paint over the affected area on the photo"
            onLayout={(e) =>
              setSize({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
            style={{
              width: "100%",
              maxWidth: (520 * photo.width) / photo.height,
              aspectRatio: photo.width / photo.height,
              overflow: "hidden",
              borderRadius: Radius.medium,
              borderCurve: "continuous",
              backgroundColor: theme.backgroundElement,
            }}
          >
            <Image
              pointerEvents="none"
              source={{ uri: photo.uri }}
              contentFit="contain"
              accessibilityLabel="Selected problem photo"
              style={{ position: "absolute", width: "100%", height: "100%" }}
            />
            {outlineUrl ? (
              <>
                {maskUrl && showFill ? (
                  <Image
                    pointerEvents="none"
                    testID="outline-fill"
                    source={{ uri: maskUrl }}
                    cachePolicy="none"
                    contentFit="contain"
                    accessible={false}
                    style={{
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                      opacity: 0.22,
                    }}
                  />
                ) : null}
                <Image
                  pointerEvents="none"
                  key={outlineUrl}
                  source={{ uri: outlineUrl }}
                  cachePolicy="none"
                  contentFit="contain"
                  accessibilityLabel="Damage outline"
                  onLoad={onMaskReady}
                  onError={onMaskError}
                  style={{ position: "absolute", width: "100%", height: "100%" }}
                />
              </>
            ) : maskUrl ? (
              <Image
                pointerEvents="none"
                key={maskUrl}
                source={{ uri: maskUrl }}
                cachePolicy="none"
                contentFit="contain"
                accessibilityLabel="SAM affected-area highlight"
                onLoad={onMaskReady}
                onError={onMaskError}
                style={{ position: "absolute", width: "100%", height: "100%" }}
              />
            ) : !reviewing ? (
              <Svg
                pointerEvents="none"
                width="100%"
                height="100%"
                viewBox={`0 0 ${photo.width} ${photo.height}`}
                style={{ position: "absolute" }}
              >
                <G
                  opacity={0.35}
                  stroke={theme.accent}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {strokes.map((stroke, i) => (
                    <Path
                      key={i}
                      testID={`brush-stroke-${i}`}
                      d={strokePath(stroke.points)}
                      strokeWidth={stroke.radius * 2}
                    />
                  ))}
                  <AnimatedPath animatedProps={animatedProps} />
                </G>
                {selection && !selection.points ? (
                  <Rect
                    x={selection.x1}
                    y={selection.y1}
                    width={selection.x2 - selection.x1 + 1}
                    height={selection.y2 - selection.y1 + 1}
                    fill={theme.accent}
                    opacity={0.3}
                  />
                ) : null}
              </Svg>
            ) : null}
          </View>
        </GestureDetector>
      </View>
      {canDraw ? (
        <View
          style={{
            paddingHorizontal: Spacing.two,
            paddingTop: Spacing.two,
            gap: Spacing.two,
          }}
        >
          <Copy variant="caption" style={{ fontWeight: "600" }}>
            Brush size
          </Copy>
          <SegmentedControl
            accessibilityLabel="Brush size"
            values={BRUSH_LABELS}
            selectedIndex={brush}
            onChange={({ nativeEvent }) =>
              setBrush(nativeEvent.selectedSegmentIndex)
            }
          />
          {strokes.length >= MAX_STROKES ? (
            <Copy variant="caption" muted>
              Stroke limit reached. Undo or clear to keep painting.
            </Copy>
          ) : null}
          <View style={{ flexDirection: "row", gap: Spacing.two }}>
            <View style={{ flex: 1 }}>
              <Action
                label="Undo stroke"
                text
                disabled={!strokes.length}
                onPress={() => update(strokes.slice(0, -1))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Action
                label="Clear selection"
                text
                disabled={!selection}
                onPress={() => update([])}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
