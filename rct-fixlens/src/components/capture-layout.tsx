import { useState } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { Copy } from "@/components/fixlens-ui";
import { Radius, Spacing, Typography } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const stages = ["Photo", "Mark", "Review"];

export function CaptureProgress({ step }: { step: number }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Step ${step + 1} of ${stages.length}: ${stages[step]}`}
      style={{ flexDirection: "row", gap: Spacing.two }}
    >
      {stages.map((stage, index) => (
        <View key={stage} style={{ flex: 1, gap: Spacing.one }}>
          <View
            style={{
              height: Spacing.one,
              borderRadius: Radius.pill,
              backgroundColor: index <= step ? theme.accent : theme.border,
            }}
          />
          <Copy
            variant="eyebrow"
            selectable={false}
            style={{ color: index === step ? theme.accent : theme.textSecondary }}
          >
            0{index + 1} {stage.toUpperCase()}
          </Copy>
        </View>
      ))}
    </View>
  );
}

export function CaptureField({
  label,
  help,
  ...props
}: TextInputProps & { label: string; help?: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: Spacing.two }}>
      <Copy style={{ fontWeight: "600" }}>{label}</Copy>
      <TextInput
        {...props}
        accessibilityLabel={label}
        accessibilityHint={help}
        placeholderTextColor={theme.textSecondary}
        selectionColor={theme.accent}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...Typography.body,
          color: theme.text,
          backgroundColor: theme.background,
          minHeight: props.multiline ? 112 : 48,
          maxHeight: props.multiline ? 200 : undefined,
          paddingHorizontal: Spacing.three,
          paddingVertical: 12,
          borderWidth: 1,
          borderRadius: Radius.medium,
          borderCurve: "continuous",
          borderColor: focused ? theme.accent : theme.border,
          textAlignVertical: props.multiline ? "top" : "center",
        }}
      />
      {help ? <Copy variant="caption" muted>{help}</Copy> : null}
    </View>
  );
}

export function CaptureIllustration() {
  const theme = useTheme();
  return (
    <Svg width="100%" height={132} viewBox="0 0 300 132" accessible={false}>
      <Rect x={28} y={12} width={244} height={108} rx={20} fill={theme.surface} />
      <Path d="M109 12v108m82-108v108M28 48h244M28 84h244" stroke={theme.border} fill="none" />
      <Path
        d="M117 44h-12v12m78-12h12v12m0 20v12h-12m-78-12v12h12"
        fill="none"
        stroke={theme.accent}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="m122 83 17-14 10 3 9-16 20-9m-29 25 7 13 13 5" fill="none" stroke={theme.accent} strokeWidth={12} strokeLinecap="round" opacity={0.18} />
      <Path d="m122 83 17-14 10 3 9-16 20-9m-29 25 7 13 13 5" fill="none" stroke={theme.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
