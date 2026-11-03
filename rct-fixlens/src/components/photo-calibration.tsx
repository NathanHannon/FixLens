import { useState } from "react";
import { Keyboard, View } from "react-native";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Host,
  Column,
  Picker,
  Switch,
  TextInput,
  Text as NativeText,
  useNativeState,
} from "@expo/ui";
import Svg, { Circle, Polygon, Text as SvgText } from "react-native-svg";
import type { Photo, SelectionPoint, CalibrationInput } from "@/api/types";
import { Action, Copy, Notice, Section } from "./fixlens-ui";
import { Spacing, Typography } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { referenceSize, type ReferenceUnit } from "@/lib/reference-size";

export function PhotoCalibration({
  photo,
  onDone,
}: {
  photo: Photo;
  onDone: (calibration?: CalibrationInput) => void;
}) {
  const theme = useTheme();
  const existing =
    photo.calibration?.method === "known_rectangle" ||
    photo.calibration?.method === "reference_card"
      ? photo.calibration
      : undefined;
  const [method, setMethod] = useState(existing?.method ?? "reference_card");
  const [points, setPoints] = useState<SelectionPoint[]>(
    existing?.points ?? [],
  );
  const [unit, setUnit] = useState<ReferenceUnit>("cm");
  const measuredWidth = useNativeState(
    existing ? String(existing.width_mm / 10) : "",
  );
  const measuredHeight = useNativeState(
    existing ? String(existing.height_mm / 10) : "",
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [samePlane, setSamePlane] = useState(false);
  const [error, setError] = useState("");
  const gesture = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, ok) => {
      if (ok && size.width > 0) {
        Keyboard.dismiss();
        const point = {
          x: Math.max(
            0,
            Math.min(photo.width, (e.x * photo.width) / size.width),
          ),
          y: Math.max(
            0,
            Math.min(photo.height, (e.y * photo.height) / size.height),
          ),
        };
        setPoints((current) =>
          current.length < 4 ? [...current, point] : current,
        );
      }
    });
  const custom = method === "known_rectangle";
  function useReference() {
    const dimensions = custom
      ? referenceSize(measuredWidth.value, measuredHeight.value, unit)
      : { width_mm: 85.6, height_mm: 53.98 };
    if (!dimensions) {
      setError(
        "Enter the actual measured width and height. Each side must be between 1 cm and 2 m (about 0.4–78.7 inches). Use decimal numbers, not fractions.",
      );
      return;
    }
    const cross = points.map((a, i) => {
      const b = points[(i + 1) % 4],
        c = points[(i + 2) % 4];
      return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    });
    if (!cross.every((c) => c > 1) && !cross.every((c) => c < -1)) {
      setError(
        "Those corners cross or overlap. Undo and tap around the rectangle in order.",
      );
      return;
    }
    Keyboard.dismiss();
    onDone({
      method: custom ? "known_rectangle" : "reference_card",
      points,
      ...dimensions,
    });
  }
  return (
    <Section>
      <Copy variant="headline">Add a size reference (optional)</Copy>
      <Host matchContents ignoreSafeArea="all" seedColor={theme.accent}>
        <Picker
          testID="reference-method"
          selectedValue={method}
          onValueChange={(value) => {
            setMethod(value);
            setPoints([]);
            setSamePlane(false);
            setError("");
          }}
        >
          <Picker.Item value="reference_card" label="Standard card" />
          <Picker.Item value="known_rectangle" label="Known-size rectangle" />
        </Picker>
      </Host>
      <Copy muted>
        {custom
          ? "Use a rectangle already visible in this photo, such as a tile you can measure. It must lie on the same flat surface as the damage. Enter its actual dimensions, not a guessed or nominal size."
          : "Use a standard bank-size plastic card, 85.60 × 53.98 mm, blank side up and flat beside the damage. The card must already be visible in this photo."}
      </Copy>
      <Copy>
        {custom
          ? "Tap all four corners around the rectangle. Width is edge 1 → 2; height is edge 2 → 3. All four corners must be visible."
          : "Tap its four corners in order, starting along a long edge. The first two taps must follow the long edge."}
      </Copy>
      {custom ? (
        <Host matchContents ignoreSafeArea="all" seedColor={theme.accent}>
          <Column spacing={Spacing.two} style={{ width: "100%" }}>
            <NativeText textStyle={Typography.body}>Units</NativeText>
            <Picker
              testID="reference-unit"
              selectedValue={unit}
              onValueChange={(value) => {
                setUnit(value as ReferenceUnit);
                setError("");
              }}
            >
              <Picker.Item value="cm" label="Centimeters" />
              <Picker.Item value="in" label="Inches" />
              <Picker.Item value="mm" label="Millimeters" />
            </Picker>
            <NativeText textStyle={Typography.body}>
              Width · corners 1 → 2
            </NativeText>
            <TextInput
              value={measuredWidth}
              placeholder="Measured width"
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={12}
              style={{ padding: Spacing.three, width: "100%" }}
              onChangeText={() => setError("")}
            />
            <NativeText textStyle={Typography.body}>
              Height · corners 2 → 3
            </NativeText>
            <TextInput
              value={measuredHeight}
              placeholder="Measured height"
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={12}
              style={{ padding: Spacing.three, width: "100%" }}
              onChangeText={() => setError("")}
            />
          </Column>
        </Host>
      ) : null}
      <GestureDetector gesture={gesture}>
        <View
          testID="photo-calibration"
          accessibilityLabel="Tap four reference rectangle corners"
          onLayout={(e) => setSize(e.nativeEvent.layout)}
          style={{ width: "100%", aspectRatio: photo.width / photo.height }}
        >
          <Image
            source={{ uri: photo.uri }}
            contentFit="fill"
            pointerEvents="none"
            style={{ width: "100%", height: "100%" }}
          />
          <Svg
            pointerEvents="none"
            viewBox={`0 0 ${photo.width} ${photo.height}`}
            style={{ position: "absolute", width: "100%", height: "100%" }}
          >
            {points.length > 1 ? (
              <Polygon
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="rgba(17,107,93,0.16)"
                stroke={theme.accent}
                strokeWidth={photo.width / 150}
              />
            ) : null}
            {points.map((p, i) => (
              <ViewlessPoint
                key={i}
                p={p}
                i={i}
                width={photo.width}
                color={theme.accent}
              />
            ))}
          </Svg>
        </View>
      </GestureDetector>
      <Copy variant="caption" muted>
        {points.length} / 4 corners selected
      </Copy>
      <View style={{ flexDirection: "row", gap: Spacing.two }}>
        <View style={{ flex: 1 }}>
          <Action
            label="Undo corner"
            secondary
            disabled={!points.length}
            onPress={() => {
              setPoints(points.slice(0, -1));
              setError("");
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Action
            label="Clear corners"
            secondary
            disabled={!points.length}
            onPress={() => {
              setPoints([]);
              setError("");
            }}
          />
        </View>
      </View>
      <Host matchContents ignoreSafeArea="all" seedColor={theme.accent}>
        <Column spacing={Spacing.two}>
          <Switch
            label={
              custom
                ? "Measured rectangle on the same flat surface"
                : "Standard card on the same flat surface"
            }
            value={samePlane}
            onValueChange={setSamePlane}
          />
        </Column>
      </Host>
      {error ? <Notice warning>{error}</Notice> : null}
      <Copy muted>
        Approximate area only. This does not measure crack width or certify
        structural safety. Rounded corners and uncertain taps affect accuracy.
      </Copy>
      <Action
        label={custom ? "Use measured rectangle" : "Use reference card"}
        disabled={points.length !== 4 || !samePlane}
        onPress={useReference}
      />
      <Action
        label="Continue without measurements"
        secondary
        onPress={() => onDone()}
      />
    </Section>
  );
}
function ViewlessPoint({
  p,
  i,
  width,
  color,
}: {
  p: SelectionPoint;
  i: number;
  width: number;
  color: string;
}) {
  return (
    <>
      <Circle cx={p.x} cy={p.y} r={width / 35} fill={color} />
      <SvgText
        x={p.x}
        y={p.y + width / 100}
        fill="white"
        fontSize={width / 30}
        textAnchor="middle"
      >
        {i + 1}
      </SvgText>
    </>
  );
}
