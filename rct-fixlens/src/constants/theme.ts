/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import "@/global.css";

import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#142D27",
    background: "#F4F7F5",
    surface: "#FFFFFF",
    border: "#DFE8E3",
    danger: "#B83D3D",
    dangerSurface: "#FFF0EF",
    backgroundElement: "#F0F0F3",
    backgroundSelected: "#E0E1E6",
    textSecondary: "#60646C",
    accent: "#116B5D",
    onAccent: "#FFFFFF",
    accentSurface: "#E5F1ED",
    warning: "#8C351D",
    warningSurface: "#FFF0E9",
  },
  dark: {
    text: "#EDF7F2",
    background: "#0C1411",
    surface: "#16231E",
    border: "#2A4035",
    danger: "#FFAAA2",
    dangerSurface: "#3D211F",
    backgroundElement: "#212225",
    backgroundSelected: "#2E3135",
    textSecondary: "#B0B4BA",
    accent: "#8BD9C6",
    onAccent: "#0C2921",
    accentSurface: "#173A32",
    warning: "#FFB79C",
    warningSurface: "#44281F",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

export const Typography = {
  display: { fontSize: 34, lineHeight: 38, fontWeight: "700", letterSpacing: -1.2 },
  eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: "700", letterSpacing: 1.5 },
  title: { fontSize: 26, lineHeight: 34, fontWeight: "600" },
  headline: { fontSize: 18, lineHeight: 26, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 24 },
  caption: { fontSize: 13, lineHeight: 20 },
} as const;
export const Radius = { small: 8, medium: 16, large: 24, pill: 999 } as const;
