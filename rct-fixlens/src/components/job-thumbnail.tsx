import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import { Radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
export function JobThumbnail({ uri }: { uri?: string }) {
  const theme = useTheme();
  const [failedUri, setFailedUri] = useState<string>();
  return (
    <View
      style={{
        width: 88,
        height: 88,
        borderRadius: Radius.medium,
        backgroundColor: theme.accentSurface,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {uri && uri !== failedUri ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          accessibilityLabel="Latest job photo"
          onError={() => setFailedUri(uri)}
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <Svg width={40} height={40} viewBox="0 0 32 32">
          <Path
            d="M4 15 16 5l12 10M8 13v14h16V13M17 12l-4 7h5l-3 7"
            fill="none"
            stroke={theme.accent}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </View>
  );
}
