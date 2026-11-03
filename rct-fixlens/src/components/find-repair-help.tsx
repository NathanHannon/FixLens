import { useRef, useState } from "react";
import { Keyboard, ScrollView, useWindowDimensions } from "react-native";
import {
  BottomSheet,
  Column,
  Host,
  RNHostView,
  TextInput,
  useNativeState,
} from "@expo/ui";
import * as Linking from "expo-linking";
import type { Report } from "@/api/types";
import { Action, Copy, Notice } from "./fixlens-ui";
import { repairSearchUrl, suggestedRepairTrade } from "@/lib/repair-search";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function FindRepairHelp({ report }: { report: Report }) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const trade = useNativeState(suggestedRepairTrade(report));
  const area = useNativeState("");
  const pending = useRef(false);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function search() {
    if (pending.current) return;
    setError("");
    let url: string;
    try {
      url = repairSearchUrl(trade.value, area.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the search details.");
      return;
    }
    pending.current = true;
    setBusy(true);
    Keyboard.dismiss();
    try {
      await Linking.openURL(url);
      setOpen(false);
    } catch {
      setError("Maps could not open. Your search is still here; try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Action
        label="Find repair help"
        secondary
        onPress={() => {
          setError("");
          setOpen(true);
        }}
      />
      <Host ignoreSafeArea="all" seedColor={theme.accent}>
        <BottomSheet
          isPresented={open}
          onDismiss={() => {
            if (!pending.current) setOpen(false);
          }}
          shouldDismissOnBackPress={!busy}
          shouldDismissOnClickOutside={!busy}
          containerColor={theme.surface}
        >
          <RNHostView matchContents={{ vertical: true }}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              style={{ height: Math.min(height * 0.7, 600) }}
              contentContainerStyle={{
                gap: Spacing.three,
                paddingBottom: Spacing.three,
              }}
            >
              <Copy variant="title">Repair professionals</Copy>
              <Copy muted>
                See matching businesses and their locations in Google Maps.
              </Copy>
              <Copy variant="caption">Repair type</Copy>
              <Host
                matchContents={{ vertical: true }}
                style={{ width: "100%" }}
                ignoreSafeArea="all"
                seedColor={theme.accent}
              >
                <Column spacing={Spacing.two} style={{ width: "100%" }}>
                  <TextInput
                    value={trade}
                    placeholder="Plumber, electrician, concrete repair"
                    testID="repair-trade"
                    maxLength={120}
                    editable={!busy}
                    placeholderTextColor={theme.textSecondary}
                    textStyle={{ color: theme.text }}
                    style={{
                      padding: Spacing.three,
                      width: "100%",
                      backgroundColor: theme.surface,
                    }}
                  />
                  <TextInput
                    value={area}
                    placeholder="City or ZIP / postal code (optional)"
                    testID="repair-area"
                    maxLength={100}
                    editable={!busy}
                    autoCorrect={false}
                    placeholderTextColor={theme.textSecondary}
                    textStyle={{ color: theme.text }}
                    style={{
                      padding: Spacing.three,
                      width: "100%",
                      backgroundColor: theme.surface,
                    }}
                  />
                </Column>
              </Host>
              <Copy variant="caption" muted>
                Leave the area blank to let Maps search nearby. Your photo and
                report aren’t included in this search. Listings aren’t vetted by
                FixLens.
              </Copy>
              {error ? <Notice warning>{error}</Notice> : null}
              <Action
                label={
                  busy
                    ? "Opening Maps…"
                    : error
                      ? "Try Maps again"
                      : "Open results in Google Maps"
                }
                disabled={busy}
                onPress={() => void search()}
                testID="open-repair-maps"
              />
              <Action
                label="Cancel"
                secondary
                disabled={busy}
                onPress={() => setOpen(false)}
              />
            </ScrollView>
          </RNHostView>
        </BottomSheet>
      </Host>
    </>
  );
}
