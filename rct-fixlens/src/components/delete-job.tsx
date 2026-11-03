import { useRef, useState } from "react";
import { BottomSheet, Host, RNHostView } from "@expo/ui";
import { api, errorMessage } from "@/api/client";
import type { JobDeletion } from "@/api/types";
import { Action, Copy, Notice, Section } from "./fixlens-ui";
import { useTheme } from "@/hooks/use-theme";
export function DeleteJob({
  id,
  title,
  onDeleted,
  compact = false,
}: {
  id: string;
  title: string;
  onDeleted: (result: JobDeletion) => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  const pending = useRef(false);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.deleteProblem(id);
      setOpen(false);
      onDeleted(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Action
        label={compact ? "Delete" : "Delete job and cloud files"}
        danger
        text={compact}
        secondary={!compact}
        onPress={() => {
          setError("");
          setOpen(true);
        }}
        testID={"delete-job-" + id}
      />
      <Host ignoreSafeArea="all" seedColor={theme.accent}>
        <BottomSheet
          isPresented={open}
          onDismiss={() => {
            if (!pending.current) setOpen(false);
          }}
          shouldDismissOnBackPress={!busy}
          shouldDismissOnClickOutside={!busy}
        >
          <RNHostView matchContents={{ vertical: true }}>
            <Section>
              <Copy variant="title">Delete this job?</Copy>
              <Copy variant="headline" numberOfLines={3}>
                {title}
              </Copy>
              <Copy muted>
                This permanently removes the job, reports, photos, saved
                outlines, and temporary cloud files. Device copies stay on your
                phone.
              </Copy>
              <Copy variant="caption" muted>
                Cloud cleanup retries automatically if interrupted and checks
                again for late uploads.
              </Copy>
              {error ? <Notice warning>{error}</Notice> : null}
              <Action
                label={
                  busy
                    ? "Deleting…"
                    : error
                      ? "Retry deletion"
                      : "Delete permanently"
                }
                danger
                disabled={busy}
                onPress={() => void remove()}
                testID="confirm-delete-job"
              />
              <Action
                label="Keep job"
                secondary
                disabled={busy}
                onPress={() => setOpen(false)}
              />
            </Section>
          </RNHostView>
        </BottomSheet>
      </Host>
    </>
  );
}
