import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import {
  Link,
  router,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { Host, Picker, TextInput, useNativeState } from "@expo/ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { api, errorMessage } from "@/api/client";
import { categories, urgencyLabels, type Problem } from "@/api/types";
import {
  Copy,
  Action,
  Notice,
  Panel,
  Section,
  StatusBadge,
} from "@/components/fixlens-ui";
import { DeleteJob } from "./delete-job";
import { JobThumbnail } from "./job-thumbnail";
import { Radius, Spacing, MaxContentWidth } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export default function ProblemsHome() {
  const theme = useTheme(),
    insets = useSafeAreaInsets();
  const { deleted } = useLocalSearchParams<{ deleted?: string }>();
  const [problems, setProblems] = useState<Problem[]>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const search = useNativeState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await api.problems(signal);
      if (!signal?.aborted) {
        setProblems(result);
        setError("");
      }
    } catch (e) {
      if (!signal?.aborted) setError(errorMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      void load(controller.signal);
      return () => controller.abort();
    }, [load]),
  );
  const attention =
    problems?.filter(
      (p) =>
        p.current_urgency === "pro_now" || p.current_urgency === "fix_soon",
    ).length ?? 0;
  const visible =
    problems?.filter(
      (p) =>
        (p.title + " " + (p.location_note ?? "") + " " + categories[p.category])
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
        (filter === "all" ||
          (filter === "attention" &&
            (p.current_urgency === "pro_now" ||
              p.current_urgency === "fix_soon")) ||
          (filter === "monitor" && p.current_urgency === "monitor")),
    ) ?? [];
  return (
    <FlatList
      data={visible}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{
        padding: Spacing.four,
        gap: Spacing.three,
        paddingBottom: insets.bottom + Spacing.four,
        maxWidth: MaxContentWidth,
        width: "100%",
        alignSelf: "center",
      }}
      refreshControl={
        <RefreshControl
          refreshing={loading && problems !== undefined}
          onRefresh={() => void load()}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: Spacing.three }}>
          <View
            style={{
              backgroundColor: theme.accentSurface,
              borderRadius: Radius.large,
              borderCurve: "continuous",
              padding: Spacing.three,
              gap: Spacing.three,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: Spacing.two,
              }}
            >
              <View style={{ flex: 1, gap: Spacing.one }}>
                <Copy
                  variant="caption"
                  style={{
                    color: theme.accent,
                    letterSpacing: 1.2,
                    fontWeight: "700",
                  }}
                >
                  HOME INSPECTION
                </Copy>
                <Copy variant="title" accessibilityRole="header">
                  {problems?.length === 0 && !error
                    ? "Start with one photo."
                    : "Your home, in focus."}
                </Copy>
              </View>
              <Svg
                width={Spacing.six}
                height={Spacing.six}
                viewBox="0 0 64 64"
                accessible={false}
              >
                <Path
                  d="M6 19V6h13m26 0h13v13m0 26v13H45m-26 0H6V45"
                  stroke={theme.accent}
                  strokeWidth={2}
                  opacity={0.45}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path
                  d="M15 31 32 17l17 14M20 29v19h24V29M34 29l-6 8h7l-4 8"
                  stroke={theme.accent}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
            <Copy muted>
              See what needs fixing, from a photo.
            </Copy>
            <Action
              label="Check a problem"
              testID="check-problem"
              onPress={() => router.push("/capture")}
            />
          </View>
          <Copy variant="caption" muted>
            Shared demo · Saved jobs are visible to everyone.
          </Copy>
          {message || deleted ? (
            <Notice>
              {message || "Job removed. Background cloud cleanup is finishing."}
            </Notice>
          ) : null}
          {problems?.length ? (
            <View style={{ gap: Spacing.two }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: Spacing.two,
                }}
              >
                <Copy variant="headline" accessibilityRole="header">
                  Saved jobs ({problems.length})
                </Copy>
                {attention > 0 ? (
                  <StatusBadge
                    label={`Needs attention (${attention})`}
                    warning
                  />
                ) : null}
              </View>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: Spacing.two,
                }}
              >
                <Host
                  matchContents={{ vertical: true }}
                  ignoreSafeArea="all"
                  seedColor={theme.accent}
                  style={{ flexGrow: 1, flexBasis: 140 }}
                >
                  <TextInput
                    value={search}
                    onChangeText={setQuery}
                    placeholder="Search jobs"
                    placeholderTextColor={theme.textSecondary}
                    autoCorrect={false}
                    textStyle={{ color: theme.text }}
                    style={{
                      padding: Spacing.two,
                      width: "100%",
                      backgroundColor: theme.surface,
                    }}
                  />
                </Host>
                <Host
                  matchContents
                  ignoreSafeArea="all"
                  seedColor={theme.accent}
                >
                  <Picker
                    selectedValue={filter}
                    onValueChange={setFilter}
                    testID="job-filter"
                  >
                    <Picker.Item value="all" label="All jobs" />
                    <Picker.Item value="attention" label="Needs attention" />
                    <Picker.Item value="monitor" label="Monitoring" />
                  </Picker>
                </Host>
              </View>
            </View>
          ) : null}
          {error ? (
            <Section>
              <Notice warning>{error}</Notice>
              <Action label="Try again" secondary onPress={() => void load()} />
            </Section>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        loading && !problems ? (
          <Copy muted>Loading your home…</Copy>
        ) : problems && !error ? (
          <Panel>
            <Copy variant="headline">
              {problems.length
                ? "No matching jobs"
                : "A place for every home check."}
            </Copy>
            <Copy muted>
              {problems.length
                ? "Try another search or filter."
                : "Your photos, assessments, and follow-up checks will be saved here."}
            </Copy>
          </Panel>
        ) : undefined
      }
      renderItem={({ item }) => (
        <Panel>
          <Link
            href={{ pathname: "/problem/[id]", params: { id: item.id } }}
            asChild
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={"Open " + item.title}
              style={({ pressed }) => ({
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <View
                style={{
                  flexDirection: "row",
                  gap: Spacing.three,
                  alignItems: "center",
                }}
              >
                <JobThumbnail uri={item.latest_capture?.photo_url} />
                <View style={{ flex: 1, gap: Spacing.one }}>
                  <Copy variant="caption" muted>
                    {categories[item.category]}
                  </Copy>
                  <Copy variant="headline" numberOfLines={2}>
                    {item.title}
                  </Copy>
                  <Copy variant="caption" muted>
                    {item.location_note ||
                      new Date(item.created_at).toLocaleDateString()}
                  </Copy>
                </View>
                <Svg width={16} height={16} viewBox="0 0 16 16" accessible={false}>
                  <Path
                    d="m6 3 5 5-5 5"
                    fill="none"
                    stroke={theme.accent}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
            </Pressable>
          </Link>
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.border,
              paddingTop: Spacing.one,
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              columnGap: Spacing.two,
            }}
          >
            <StatusBadge
              label={
                item.current_urgency
                  ? urgencyLabels[item.current_urgency]
                  : "Ready for assessment"
              }
              warning={
                item.current_urgency === "pro_now" ||
                item.current_urgency === "fix_soon"
              }
            />
            <View style={{ alignSelf: "flex-end" }}>
              <DeleteJob
                id={item.id}
                title={item.title}
                compact
                onDeleted={(result) => {
                  setProblems((current) =>
                    current?.filter((p) => p.id !== item.id),
                  );
                  setMessage(
                    result.status === "deleting"
                      ? "Job removal queued. Cloud cleanup will retry automatically."
                      : "Job removed. Late uploads will be cleaned automatically.",
                  );
                }}
              />
            </View>
          </View>
        </Panel>
      )}
    />
  );
}
