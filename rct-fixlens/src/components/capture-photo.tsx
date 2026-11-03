import { useEffect, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { Host, Switch } from "@expo/ui";
import { api } from "@/api/client";
import type { CaptureMedia } from "@/api/types";
import { Action, Copy } from "./fixlens-ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
export function CapturePhoto({
  problemId,
  captureId,
}: {
  problemId: string;
  captureId: string;
}) {
  const theme = useTheme();
  const [media, setMedia] = useState<CaptureMedia>(),
    [error, setError] = useState(false),
    [outline, setOutline] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void api
      .media(problemId, captureId)
      .then((value) => {
        if (active) setMedia(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [problemId, captureId, attempt]);
  return (
    <View style={{ gap: Spacing.two }}>
      {!error ? (
        <View
          style={{
            width: "100%",
            aspectRatio: 4 / 3,
            maxHeight: 220,
            overflow: "hidden",
            borderRadius: Radius.medium,
            borderCurve: "continuous",
            backgroundColor: theme.backgroundElement,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {media ? (
            <>
              <Image
                source={{ uri: media.photo.url }}
                contentFit="contain"
                accessibilityLabel="Assessment photo"
                onError={() => setError(true)}
                style={{ width: "100%", height: "100%" }}
              />
              {outline && media.mask ? (
                <Image
                  source={{ uri: media.mask.url }}
                  contentFit="contain"
                  accessibilityLabel="Saved damage outline"
                  onError={() => setOutline(false)}
                  style={{ position: "absolute", width: "100%", height: "100%" }}
                />
              ) : null}
            </>
          ) : (
            <Copy variant="caption" muted>
              Loading photo…
            </Copy>
          )}
        </View>
      ) : (
        <Copy variant="caption" muted>
          Photo preview unavailable.
        </Copy>
      )}
      {media && !error ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: Spacing.two,
          }}
        >
          <Copy variant="caption" muted>
            Captured photo
          </Copy>
          {media.mask ? (
            <Host matchContents ignoreSafeArea="all" seedColor={theme.accent}>
              <Switch
                label="Show damage outline"
                value={outline}
                onValueChange={setOutline}
              />
            </Host>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Action
          label="Reload photo"
          secondary
          onPress={() => {
            setError(false);
            setMedia(undefined);
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
    </View>
  );
}
