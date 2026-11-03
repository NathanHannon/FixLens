import { useRef, useState } from "react";
import { Linking } from "react-native";
import { api, errorMessage } from "@/api/client";
import { Action, Copy, Notice, Section } from "@/components/fixlens-ui";
import { requestSavePermission, saveMedia } from "@/lib/device-media";
import { MediaSaveSession } from "@/lib/media-save-session";
export function DeviceCopies({
  problemId,
  captureId,
  mock,
}: {
  problemId: string;
  captureId: string;
  mock: boolean;
}) {
  const session = useRef(new MediaSaveSession());
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  async function save() {
    if (pending.current || done) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    setBlocked(false);
    try {
      const permission = await requestSavePermission();
      if (!permission.granted) {
        setBlocked(!permission.canAskAgain);
        throw new Error(
          "Allow adding photos to save a device copy. You can enable this in Settings.",
        );
      }
      const media = await api.media(problemId, captureId);
      const result = await session.current.save(media, saveMedia);
      setMessage(
        process.env.EXPO_OS === "web"
          ? media.mask
            ? "Photo and mask downloads started."
            : "Photo download started. No segmentation mask is available."
          : result,
      );
      setDone(true);
    } catch (e) {
      const partial = session.current.photo && !session.current.mask;
      setError(
        `${partial ? (process.env.EXPO_OS === "web" ? "The photo download started. The mask is still pending. " : "The photo was saved. The mask is still pending. ") : ""}${errorMessage(e)}`,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Section>
      <Copy variant="headline">Keep a device copy</Copy>
      <Copy muted>
        {process.env.EXPO_OS === "web"
          ? "Download the assessment photo and the separate mask image."
          : "Save the assessment photo and the separate mask image to your photo library."}{" "}
        The mask is a transparent image of the selected region.
      </Copy>
      <Action
        label={
          busy
            ? "Saving images..."
            : done
              ? process.env.EXPO_OS === "web"
                ? "Downloads started"
                : "Saved to device"
              : error
                ? "Retry saving images"
                : mock
                  ? "Save photo"
                  : "Save photo and mask"
        }
        secondary
        disabled={busy || done}
        onPress={() => void save()}
      />
      {message ? <Notice>{message}</Notice> : null}
      {error ? <Notice warning>{error}</Notice> : null}
      {blocked ? (
        <Action
          label="Open Settings"
          secondary
          onPress={() => {
            void Linking.openSettings().catch(() =>
              setError(
                "Open your device Settings and allow FixLens to add photos.",
              ),
            );
          }}
        />
      ) : null}
    </Section>
  );
}
