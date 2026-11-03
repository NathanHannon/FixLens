import "../safe-area.css";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Stack } from "expo-router/stack";
import {
  ThemeProvider,
  DarkTheme,
  DefaultTheme,
} from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { useTheme } from "@/hooks/use-theme";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerTintColor: theme.accent,
            headerStyle: { backgroundColor: theme.surface },
            contentStyle: { backgroundColor: theme.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: "FixLens" }} />
          <Stack.Screen name="capture" options={{ title: "Check a problem" }} />
          <Stack.Screen
            name="problem/[id]"
            options={{ title: "Your assessment" }}
          />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
