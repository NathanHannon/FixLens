import { useRef, useState } from "react";
import { BottomSheet, Host, RNHostView } from "@expo/ui";
import { api, errorMessage } from "@/api/client";
import type { JobFiles } from "@/api/types";
import { Action, Copy, Notice, Section } from "./fixlens-ui";
import { useTheme } from "@/hooks/use-theme";
export function JobStorage({ id }: { id: string }) {
  const theme = useTheme();
  const pending = useRef(false);
  const [open, setOpen] = useState(false),
    [files, setFiles] = useState<JobFiles>();
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      setFiles(await api.jobFiles(id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api.clearPreviews(id);
      setConfirm(false);
      setFiles(await api.jobFiles(id));
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
        label="Manage cloud files"
        secondary
        onPress={() => {
          setOpen(true);
          setConfirm(false);
          void load();
        }}
      />
      <Host ignoreSafeArea="all" seedColor={theme.accent}>
        <BottomSheet
          isPresented={open}
          onDismiss={() => {
            if (!pending.current) setOpen(false);
          }}
          shouldDismissOnClickOutside={!busy}
          shouldDismissOnBackPress={!busy}
        >
          <RNHostView matchContents={{ vertical: true }}>
            <Section>
              <Copy variant="title">Cloud files</Copy>
              <Copy muted>Files stored for this job.</Copy>
              {files ? (
                <>
                  <Copy>
                    {files.photos} photos · {files.outlines} saved outlines
                  </Copy>
                  <Copy>{files.previews} temporary previews</Copy>
                  <Copy variant="caption" muted>
                    {(files.bytes / (1024 * 1024)).toFixed(1)} MB stored
                  </Copy>
                </>
              ) : busy ? (
                <Copy muted>Loading files…</Copy>
              ) : null}
              {error ? (
                <>
                  <Notice warning>{error}</Notice>
                  {!confirm ? (
                    <Action
                      label="Retry file details"
                      secondary
                      disabled={busy}
                      onPress={() => void load()}
                    />
                  ) : null}
                </>
              ) : null}
              {confirm ? (
                <>
                  <Notice warning>
                    Delete temporary previews? Any highlight currently being
                    edited for this job will need to be prepared again.
                  </Notice>
                  <Action
                    label={busy ? "Clearing previews…" : "Delete previews"}
                    danger
                    disabled={busy}
                    onPress={() => void clear()}
                  />
                  <Action
                    label="Keep previews"
                    secondary
                    disabled={busy}
                    onPress={() => {
                      setConfirm(false);
                      setError("");
                    }}
                  />
                </>
              ) : (
                <Action
                  label="Clear temporary previews"
                  secondary
                  disabled={busy || !files?.previews}
                  onPress={() => setConfirm(true)}
                />
              )}
              <Copy variant="caption" muted>
                Deleting the job removes its photos, saved outlines, and
                previews together.
              </Copy>
              <Action
                label="Done"
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
