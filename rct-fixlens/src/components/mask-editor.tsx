import { useEffect, useId, useState } from "react";
import { View } from "react-native";
import { Host, Picker } from "@expo/ui";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedProps,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Svg, {
  Defs,
  Image as SvgImage,
  Mask,
  Path,
  Rect,
} from "react-native-svg";
import type { Photo, SelectionPoint } from "@/api/types";
import { Action, Copy } from "./fixlens-ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { strokePath } from "@/lib/selection";
import {
  sourcePoint,
  zoomWindow,
  type MaskEdit,
  type MaskStroke,
  type PhotoWindow,
} from "@/lib/mask-edit";
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedSvg = Animated.createAnimatedComponent(Svg);

export function MaskEditor({
  photo,
  maskUrl,
  initial,
  busy,
  onSave,
  onCancel,
  phase,
}: {
  photo: Photo;
  maskUrl?: string | null;
  initial: MaskEdit;
  busy: boolean;
  onSave: (edit: MaskEdit) => void;
  onCancel: () => void;
  phase?: string;
}) {
  const theme = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [base, setBase] = useState(initial.base);
  const [strokes, setStrokes] = useState<MaskStroke[]>(initial.strokes);
  const [mode, setMode] = useState("paint");
  const [brush, setBrush] = useState("12");
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [window, setWindow] = useState<PhotoWindow>({
    left: 0,
    top: 0,
    width: photo.width,
    height: photo.height,
  });
  const viewport = useSharedValue<PhotoWindow>({
    left: 0,
    top: 0,
    width: photo.width,
    height: photo.height,
  });
  const startWindow = useSharedValue<PhotoWindow>({
    left: 0,
    top: 0,
    width: photo.width,
    height: photo.height,
  });
  const active = useSharedValue("");
  const points = useSharedValue<SelectionPoint[]>([]);
  const radius = useSharedValue(1);
  const count = strokes.reduce((n, s) => n + s.points.length, 0);
  const capacity = Math.min(256, 8192 - count);
  useEffect(() => {
    active.set("");
  }, [strokes, active]);
  function commit(next: SelectionPoint[], r: number, tool: string) {
    if (next.length && strokes.length < 64)
      setStrokes((s) => [
        ...s,
        { points: next, radius: r, mode: tool as "paint" | "erase" },
      ]);
  }
  const gesture = Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .enabled(
      !busy &&
        size.width > 0 &&
        (mode === "move" || (strokes.length < 64 && capacity > 0)),
    )
    .onBegin((e) => {
      startWindow.set(viewport.get());
      if (mode === "move") return;
      const p = sourcePoint(
        e.x,
        e.y,
        size.width,
        size.height,
        viewport.get(),
        photo.width,
        photo.height,
      );
      radius.set(
        Math.max(
          0.5,
          Math.min(
            512,
            (Number(brush) * viewport.get().width) / size.width / 2,
          ),
        ),
      );
      points.set([p]);
      active.set(`M${p.x},${p.y}L${p.x + 0.01},${p.y}`);
    })
    .onUpdate((e) => {
      if (mode === "move") {
        const start = startWindow.get();
        viewport.set({
          ...start,
          left: Math.max(
            0,
            Math.min(
              photo.width - start.width,
              start.left - (e.translationX * start.width) / size.width,
            ),
          ),
          top: Math.max(
            0,
            Math.min(
              photo.height - start.height,
              start.top - (e.translationY * start.height) / size.height,
            ),
          ),
        });
        return;
      }
      const p = sourcePoint(
        e.x,
        e.y,
        size.width,
        size.height,
        viewport.get(),
        photo.width,
        photo.height,
      );
      const current = points.get(),
        last = current[current.length - 1];
      if (
        current.length >= capacity ||
        Math.hypot(p.x - last.x, p.y - last.y) <
          (viewport.get().width / size.width) * 2
      )
        return;
      points.set([...current, p]);
      active.set(active.get() + `L${p.x},${p.y}`);
    })
    .onEnd(() => {
      if (mode === "move") scheduleOnRN(setWindow, viewport.get());
      else scheduleOnRN(commit, points.get(), radius.get(), mode);
    })
    .onFinalize((_e, success) => {
      if (!success) active.set("");
    });
  const viewProps = useAnimatedProps<{
    viewBox?: string;
    minX?: number;
    minY?: number;
    vbWidth?: number;
    vbHeight?: number;
  }>(() => {
    const v = viewport.get();
    // Native SVG extracts viewBox in its React wrapper. Animate the actual
    // native viewport fields so zoom/panning also update on iOS and Android.
    return process.env.EXPO_OS === "web"
      ? { viewBox: `${v.left} ${v.top} ${v.width} ${v.height}` }
      : { minX: v.left, minY: v.top, vbWidth: v.width, vbHeight: v.height };
  });
  const pathProps = useAnimatedProps(() => ({
    d: active.get(),
    strokeWidth: radius.get() * 2,
  }));
  function changeZoom(next: number) {
    setZoom(next);
    const nextWindow = zoomWindow(
      viewport.get(),
      next,
      photo.width,
      photo.height,
    );
    viewport.set(nextWindow);
    setWindow(nextWindow);
  }
  return (
    <View style={{ gap: Spacing.three }}>
      <Copy variant="headline">Refine the outline</Copy>
      <Copy muted>
        Paint to add, erase to remove. Use Move to pan when zoomed in.
      </Copy>
      <GestureDetector gesture={gesture} touchAction="none">
        <View
          testID="mask-editor"
          accessibilityLabel="Editable damage highlight"
          onLayout={(e) => setSize(e.nativeEvent.layout)}
          style={{
            width: "100%",
            maxWidth: (520 * photo.width) / photo.height,
            alignSelf: "center",
            aspectRatio: photo.width / photo.height,
            overflow: "hidden",
            borderRadius: Radius.medium,
            backgroundColor: theme.backgroundElement,
          }}
        >
          <AnimatedSvg
            width="100%"
            height="100%"
            viewBox={`${window.left} ${window.top} ${window.width} ${window.height}`}
            animatedProps={viewProps}
          >
            <Defs>
              <Mask
                id={`${id}base`}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={photo.width}
                height={photo.height}
                maskType="alpha"
              >
                {base === "preview" && maskUrl ? (
                  <SvgImage
                    href={{ uri: maskUrl }}
                    width={photo.width}
                    height={photo.height}
                  />
                ) : null}
              </Mask>
              <Mask
                id={`${id}edit`}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={photo.width}
                height={photo.height}
                maskType="luminance"
              >
                <Rect width={photo.width} height={photo.height} fill="black" />
                {base === "preview" ? (
                  <Rect
                    width={photo.width}
                    height={photo.height}
                    fill="white"
                    mask={`url(#${id}base)`}
                  />
                ) : null}
                {strokes.map((s, i) => (
                  <Path
                    key={i}
                    d={strokePath(s.points)}
                    fill="none"
                    stroke={s.mode === "paint" ? "white" : "black"}
                    strokeWidth={s.radius * 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                <AnimatedPath
                  animatedProps={pathProps}
                  fill="none"
                  stroke={mode === "erase" ? "black" : "white"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Mask>
            </Defs>
            <SvgImage
              href={{ uri: photo.uri }}
              width={photo.width}
              height={photo.height}
            />
            <Rect
              width={photo.width}
              height={photo.height}
              fill={theme.accent}
              opacity={0.7}
              mask={`url(#${id}edit)`}
            />
          </AnimatedSvg>
        </View>
      </GestureDetector>
      <Host matchContents ignoreSafeArea="all" seedColor={theme.accent}>
        <Picker
          testID="mask-tool"
          selectedValue={mode}
          enabled={!busy}
          onValueChange={setMode}
        >
          <Picker.Item value="paint" label="Paint" />
          <Picker.Item value="erase" label="Erase" />
          <Picker.Item value="move" label="Move" />
        </Picker>
      </Host>
      <Host matchContents ignoreSafeArea="all" seedColor={theme.accent}>
        <Picker
          testID="mask-brush"
          selectedValue={brush}
          enabled={!busy}
          onValueChange={setBrush}
        >
          <Picker.Item value="6" label="Fine" />
          <Picker.Item value="12" label="Medium" />
          <Picker.Item value="28" label="Wide" />
        </Picker>
      </Host>
      <View style={{ flexDirection: "row", gap: Spacing.two }}>
        {[1, 2, 4].map((z) => (
          <View key={z} style={{ flex: 1 }}>
            <Action
              label={`${z}×`}
              secondary={zoom !== z}
              disabled={busy}
              onPress={() => changeZoom(z)}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: Spacing.two }}>
        <View style={{ flex: 1 }}>
          <Action
            label="Undo edit"
            secondary
            disabled={busy || !strokes.length}
            onPress={() => setStrokes((s) => s.slice(0, -1))}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Action
            label="Clear highlight"
            secondary
            disabled={busy}
            onPress={() => {
              setBase("blank");
              setStrokes([]);
            }}
          />
        </View>
      </View>
      {strokes.length >= 64 || capacity <= 0 ? (
        <Copy muted>
          Stroke limit reached. Undo an edit or save this outline before making
          more corrections.
        </Copy>
      ) : null}
      <Copy variant="caption" muted>
        This is an approximate surface outline. Trace the crack or chipped area
        you want assessed; its width and depth are not measured.
      </Copy>
      <Action
        label={
          busy
            ? phase
              ? phase + "…"
              : "Saving outline…"
            : "Use outline and assess"
        }
        disabled={
          busy || (base === "blank" && !strokes.some((s) => s.mode === "paint"))
        }
        onPress={() => onSave({ base, strokes })}
      />
      <Action
        label="Cancel edits"
        secondary
        disabled={busy}
        onPress={onCancel}
      />
    </View>
  );
}
