import { Collapsible, Host, RNHostView } from "@expo/ui";
import { useState, type PropsWithChildren } from "react";
import { Pressable, Text, View, type TextProps } from "react-native";
import { Spacing, Typography, Radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function Copy({
  variant = "body",
  muted = false,
  style,
  ...props
}: TextProps & { variant?: keyof typeof Typography; muted?: boolean }) {
  const theme = useTheme();
  return (
    <Text
      selectable
      {...props}
      style={[
        Typography[variant],
        { color: muted ? theme.textSecondary : theme.text },
        style,
      ]}
    />
  );
}
export function Section({ children }: PropsWithChildren) {
  return <View style={{ gap: Spacing.three }}>{children}</View>;
}
export function Panel({ children }: PropsWithChildren) {
  const theme = useTheme();
  return (
    <View
      style={{
        padding: Spacing.three,
        gap: Spacing.three,
        borderRadius: Radius.large,
        borderCurve: "continuous",
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      {children}
    </View>
  );
}
export function StatusBadge({
  label,
  warning = false,
}: {
  label: string;
  warning?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: Spacing.three,
        paddingVertical: Spacing.one,
        borderRadius: Radius.pill,
        backgroundColor: warning ? theme.warningSurface : theme.accentSurface,
      }}
    >
      <Copy
        variant="caption"
        style={{
          color: warning ? theme.warning : theme.accent,
          fontWeight: "600",
        }}
      >
        {label}
      </Copy>
    </View>
  );
}
export function Disclosure({
  label,
  children,
}: PropsWithChildren<{ label: string }>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Host
      matchContents={{ vertical: true }}
      style={{ width: "100%" }}
      ignoreSafeArea="all"
      seedColor={theme.accent}
    >
      <Collapsible
        isOpen={open}
        onOpenChange={setOpen}
        label={label}
        labelStyle={{ ...Typography.body, color: theme.text }}
      >
        <RNHostView matchContents={{ vertical: true }}>
          <View style={{ width: "100%", gap: Spacing.three }}>{children}</View>
        </RNHostView>
      </Collapsible>
    </Host>
  );
}
export function Notice({
  children,
  warning = false,
}: PropsWithChildren<{ warning?: boolean }>) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        padding: Spacing.three,
        borderRadius: Radius.small,
        borderCurve: "continuous",
        backgroundColor: warning ? theme.warningSurface : theme.accentSurface,
      }}
    >
      <Copy
        variant="caption"
        style={{ color: warning ? theme.warning : theme.accent }}
      >
        {children}
      </Copy>
    </View>
  );
}
export function Action({
  label,
  onPress,
  disabled = false,
  secondary = false,
  testID,
  danger = false,
  text = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  testID?: string;
  danger?: boolean;
  text?: boolean;
}) {
  const theme = useTheme();
  const color = danger ? theme.danger : theme.accent;
  const filled = !secondary && !text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: Spacing.three,
        paddingVertical: Spacing.two,
        borderRadius: Radius.medium,
        borderCurve: "continuous",
        backgroundColor: filled ? color : secondary ? theme.surface : "transparent",
        borderWidth: secondary && !text ? 1 : 0,
        borderColor: danger ? theme.danger : theme.border,
        opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
      })}
    >
      <Copy
        selectable={false}
        style={{
          color: filled ? theme.onAccent : color,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Copy>
    </Pressable>
  );
}
