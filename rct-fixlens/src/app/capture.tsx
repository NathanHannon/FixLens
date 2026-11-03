import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Keyboard, ScrollView, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  Host,
  Column,
  Picker,
  Switch,
} from "@expo/ui";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, errorMessage } from "@/api/client";
import {
  categories,
  hazards,
  type Category,
  type Hazard,
  type Photo,
  type Selection,
  type SegmentationPreview,
} from "@/api/types";
import {
  Action,
  Copy,
  Disclosure,
  Notice,
  Panel,
  Section,
} from "@/components/fixlens-ui";
import {
  CaptureField,
  CaptureIllustration,
  CaptureProgress,
} from "@/components/capture-layout";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { CaptureSession, type Phase } from "@/lib/capture-session";
import { pickPhoto, preparePhoto } from "@/lib/photos";
import type { BrushStroke } from "@/lib/selection";
import { PhotoSelection } from "@/components/photo-selection";
import { MaskEditor } from "@/components/mask-editor";
import { tracingStrokes, type MaskEdit } from "@/lib/mask-edit";
import { uploadPhoto } from "@/lib/upload";
import { PhotoCalibration } from "@/components/photo-calibration";
import { canMeasure, captureMeasuredPhoto } from "@/lib/ar-capture";
import { calibrationLabel } from "@/lib/reference-size";

export default function CaptureScreen() {
  const { problemId } = useLocalSearchParams<{ problemId?: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const session = useRef(new CaptureSession(problemId));
  const submitting = useRef(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [arAvailable, setArAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    void canMeasure().then((value) => {
      if (active) setArAvailable(value);
    });
    return () => {
      active = false;
    };
  }, []);
  const [strokes, setStrokes] = useState<BrushStroke[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<SegmentationPreview>();
  const [editing, setEditing] = useState<MaskEdit | null>(null);
  const [maskReady, setMaskReady] = useState(false);
  const [outlineFailed, setOutlineFailed] = useState(false);
  const [showFill, setShowFill] = useState(true);
  const [assessing, setAssessing] = useState(false);
  const [category, setCategory] = useState<Category>("other");
  const [flags, setFlags] = useState<Hazard[]>([]);
  const [location, setLocation] = useState("");
  const [problemType, setProblemType] = useState("");
  const [observations, setObservations] = useState("");
  const [phase, setPhase] = useState<Phase>();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const busy = Boolean(phase) || picking;
  const outlineUrl = outlineFailed ? null : preview?.outline_url;

  // Recover the system picker result if Android recreated the activity.
  useEffect(() => {
    if (process.env.EXPO_OS !== "android") return;
    let active = true;
    void ImagePicker.getPendingResultAsync()
      .then(async (result) => {
        if (
          result &&
          !("code" in result) &&
          !result.canceled &&
          result.assets?.[0]
        ) {
          const restored = await preparePhoto(result.assets[0]);
          if (active) setPhoto(restored);
        }
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, []);

  async function choose(camera: boolean, measured = false) {
    if (busy || locked) return;
    setPicking(true);
    setError("");
    try {
      const picked = measured
        ? await captureMeasuredPhoto()
        : await pickPhoto(camera);
      if (picked) {
        setPhoto(picked);
        setSelection(null);
        setStrokes([]);
        setPreview(undefined);
        setEditing(null);
        setCalibrating(false);
        scroll.current?.scrollTo({ y: 0 });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPicking(false);
    }
  }
  async function submit(assess = false, edit?: MaskEdit) {
    if (!photo || !selection || submitting.current) return;
    submitting.current = true;
    setError("");
    setLocked(true);
    setAssessing(assess);
    Keyboard.dismiss();
    try {
      const description = problemType.trim();
      const draft = {
        photo,
        category,
        title:
          `${description || (category === "other" ? "Home check" : categories[category])}${location.trim() ? ` · ${location.trim()}` : ""}`.slice(
            0,
            200,
          ),
        location: location.trim(),
        context: [
          description ? `User-described problem: ${description}` : "",
          observations.trim(),
        ]
          .filter(Boolean)
          .join("\n\n"),
        hazards: flags,
      };
      if (!assess || edit) {
        const result = await session.current.prepare(
          draft,
          selection,
          api,
          uploadPhoto,
          setPhase,
          edit,
          preview?.token,
        );
        if (!edit) {
          setPreview(result);
          setEditing(null);
          setOutlineFailed(false);
          setMaskReady(result.is_mock || (!result.mask_url && !result.outline_url));
          scroll.current?.scrollTo({ y: 0 });
          return;
        }
      }
      const id = await session.current.submit(draft, api, setPhase);
      router.replace({ pathname: "/problem/[id]", params: { id } });
    } catch (e) {
      setError(errorMessage(e));
      if (/expired/i.test(errorMessage(e))) {
        setPreview(undefined);
        session.current.preview = undefined;
      }
    } finally {
      submitting.current = false;
      setPhase(undefined);
    }
  }
  function redraw() {
    setPreview(undefined);
    session.current.preview = undefined;
    setError("");
    scroll.current?.scrollTo({ y: 0 });
  }
  function drawOutline() {
    if (!photo) return;
    if (!selection)
      setSelection({ x1: 0, y1: 0, x2: photo.width - 1, y2: photo.height - 1 });
    setEditing({ base: "blank", strokes: tracingStrokes(strokes) });
    setError("");
    scroll.current?.scrollTo({ y: 0 });
  }

  return (
    <ScrollView
      ref={scroll}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{
        padding: Spacing.four,
        gap: Spacing.three,
        paddingBottom: insets.bottom + Spacing.four,
        maxWidth: MaxContentWidth,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <Stack.Screen
        options={{
          title: problemId ? "Check again" : "Check a problem",
          gestureEnabled: !phase,
          headerBackVisible: !phase,
        }}
      />
      <CaptureProgress step={!photo ? 0 : preview || editing ? 2 : 1} />
      {!photo ? (
        <Section>
          <View style={{
            gap: Spacing.two,
            padding: Spacing.four,
            backgroundColor: theme.accentSurface,
            borderRadius: Radius.large,
            borderCurve: "continuous",
          }}>
            <CaptureIllustration />
            <Copy variant="display">
              {problemId ? "Look again." : "Show what’s wrong."}
            </Copy>
            <Copy muted>
              {problemId
                ? "Match the previous angle, distance, and lighting."
                : "Take a clear photo with a little of the surrounding area in frame."}
            </Copy>
          </View>
          <Action
            label={picking ? "Opening photo…" : "Take a photo"}
            disabled={busy}
            onPress={() => void choose(true)}
          />
          <Action
            label="Choose from photos"
            secondary
            disabled={busy}
            onPress={() => void choose(false)}
          />
          {arAvailable ? (
            <Action
              label="Take a photo with size estimate"
              secondary
              disabled={busy}
              onPress={() => void choose(true, true)}
            />
          ) : null}
          <Notice>
            For a size estimate, place a standard plastic card flat beside the
            damage before taking the photo.
          </Notice>
        </Section>
      ) : calibrating ? (
        <PhotoCalibration
          photo={photo}
          onDone={(calibration) => {
            setPhoto({ ...photo, calibration });
            setCalibrating(false);
            redraw();
          }}
        />
      ) : editing ? (
        <MaskEditor
          photo={photo}
          maskUrl={preview?.mask_url}
          initial={editing}
          busy={busy}
          phase={phase}
          onSave={(edit) => void submit(true, edit)}
          onCancel={() => {
            session.current.preview = preview;
            setEditing(null);
            setError("");
            scroll.current?.scrollTo({ y: 0 });
          }}
        />
      ) : (
        <Section>
          <Copy variant="title">
            {preview
              ? preview.status === "unavailable"
                ? "We couldn't isolate the mark."
                : "Does the highlight cover the problem?"
              : "Mark the damage."}
          </Copy>
          <PhotoSelection
            key={photo.uri}
            photo={photo}
            selection={selection}
            strokes={strokes}
            onStrokesChange={setStrokes}
            disabled={busy || Boolean(preview)}
            reviewing={Boolean(preview)}
            maskUrl={preview?.mask_url}
            outlineUrl={outlineUrl}
            showFill={showFill}
            onMaskReady={() => setMaskReady(true)}
            onMaskError={() => {
              setMaskReady(false);
              if (outlineUrl && preview?.mask_url) {
                setOutlineFailed(true);
                return;
              }
              setError("The highlight could not load. Preview the area again.");
            }}
            onChange={(value) => {
              setSelection(value);
              setPreview(undefined);
              session.current.preview = undefined;
              setError("");
            }}
          />
          {preview ? (
            <>
              {preview.status === "unavailable" ? (
                <Notice warning>
                  {preview.reason || "A reliable highlight is unavailable."}{" "}
                  Draw an outline, or continue with a photo-only assessment.
                </Notice>
              ) : (
                <>
                  <Copy muted>
                    Check that the outline follows the damage. Edit it if it
                    misses part of the mark or includes surrounding surface.
                  </Copy>
                  {outlineUrl && preview.mask_url ? (
                    <Host
                      matchContents={{ vertical: true }}
                      style={{ width: "100%" }}
                      ignoreSafeArea="all"
                      seedColor={theme.accent}
                    >
                      <Switch
                        label="Shade inside the outline"
                        value={showFill}
                        onValueChange={setShowFill}
                      />
                    </Host>
                  ) : null}
                </>
              )}
              {preview.is_mock ? (
                <Notice>
                  Demo preview · the automatic outline and counts are simulated.
                </Notice>
              ) : null}
              {preview.outline_source ? (
                <Copy variant="caption" muted>
                  {preview.outline_source === "user_drawn"
                    ? "Outline traced by you"
                    : preview.outline_source === "user_corrected"
                      ? "Outline corrected by you"
                      : "Automatic outline"}
                </Copy>
              ) : null}
              {error ? <Notice warning>{error}</Notice> : null}
              {preview.status === "unavailable" ? (
                <>
                  <Action
                    label="Draw my own outline"
                    disabled={busy}
                    onPress={drawOutline}
                  />
                  <Action
                    label={
                      phase ? phase + "…" : "Assess photo without measurements"
                    }
                    secondary
                    disabled={busy}
                    onPress={() => void submit(true)}
                  />
                </>
              ) : (
                <>
                  <Action
                    label={
                      phase
                        ? phase + "…"
                        : error && assessing
                          ? "Retry assessment"
                          : "Get assessment"
                    }
                    disabled={busy || !maskReady}
                    onPress={() => void submit(true)}
                    testID="submit-assessment"
                  />
                  <Action
                    label="Edit highlight"
                    secondary
                    disabled={busy || !maskReady}
                    onPress={() => {
                      setEditing({ base: "preview", strokes: [] });
                      setError("");
                      scroll.current?.scrollTo({ y: 0 });
                    }}
                  />
                </>
              )}
              {(preview.mask_url || outlineUrl) && !maskReady && error ? (
                <Action
                  label="Preview highlight again"
                  secondary
                  disabled={busy}
                  onPress={() => void submit(false)}
                />
              ) : null}
              <Action
                label="Adjust description or area"
                text
                disabled={busy}
                onPress={redraw}
              />
              <Copy variant="caption" muted>
                Size estimates are shown only when the outline and reference are
                usable.
              </Copy>
            </>
          ) : (
            <>
              <Panel>
                <Copy variant="eyebrow" style={{ color: theme.accent }}>
                  OPTIONAL PHOTO NOTES
                </Copy>
                <CaptureField
                  label="What is it?"
                  value={problemType}
                  onChangeText={setProblemType}
                  placeholder="Ceiling scuff, peeling paint, chipped tile"
                  maxLength={120}
                  editable={!locked}
                />
                <CaptureField
                  label="Describe what to highlight"
                  value={observations}
                  onChangeText={setObservations}
                  placeholder="Thin gray scuff near the light, not the whole ceiling"
                  multiline
                  maxLength={1800}
                  editable={!busy}
                  help="Describe the mark’s shape, color, and location, plus anything to leave out."
                />
              </Panel>
              <Disclosure
                label={
                  flags.length
                    ? "Safety concerns · " + flags.length + " selected"
                    : "Safety concerns"
                }
              >
                <Host
                  matchContents={{ vertical: true }}
                  style={{ width: "100%" }}
                  ignoreSafeArea="all"
                  seedColor={theme.accent}
                >
                  <Column spacing={Spacing.three} style={{ width: "100%" }}>
                    {(Object.entries(hazards) as [Hazard, string][]).map(
                      ([key, label]) => (
                        <Switch
                          key={key}
                          label={label}
                          disabled={busy}
                          value={flags.includes(key)}
                          onValueChange={(checked) =>
                            setFlags((current) =>
                              checked
                                ? [...current, key]
                                : current.filter((value) => value !== key),
                            )
                          }
                        />
                      ),
                    )}
                  </Column>
                </Host>
              </Disclosure>
              {flags.length ? (
                <Notice warning>
                  A safety concern is flagged. The assessment will prioritize
                  professional help.
                </Notice>
              ) : null}
              {error ? <Notice warning>{error}</Notice> : null}
              <View style={{ gap: Spacing.one }}>
                <Action
                  label={phase ? phase + "…" : "Preview highlight"}
                  disabled={busy || !selection}
                  onPress={() => void submit()}
                  testID="submit-assessment"
                />
                <Action
                  label={strokes.length ? "Use my tracing" : "Draw my own outline"}
                  text
                  disabled={busy}
                  onPress={drawOutline}
                />
              </View>
              <Panel>
                <Copy variant="eyebrow" style={{ color: theme.accent }}>
                  CAPTURE OPTIONS
                </Copy>
                {!problemId ? (
                  <Disclosure label="More details (optional)">
                    <CaptureField
                      label="Where is it?"
                      value={location}
                      onChangeText={setLocation}
                      placeholder="Basement, north wall"
                      maxLength={1000}
                      editable={!locked}
                    />
                    <Copy>Category</Copy>
                    <Host
                      matchContents={{ vertical: true }}
                      style={{ width: "100%" }}
                      ignoreSafeArea="all"
                      seedColor={theme.accent}
                    >
                      <Picker
                        selectedValue={category}
                        enabled={!locked}
                        onValueChange={setCategory}
                      >
                        {Object.entries(categories).map(([value, label]) => (
                          <Picker.Item key={value} value={value} label={label} />
                        ))}
                      </Picker>
                    </Host>
                  </Disclosure>
                ) : null}
                <Disclosure
                  label={
                    photo.calibration
                      ? "Size reference added"
                      : "Size estimate (optional)"
                  }
                >
                  <Copy muted>
                    {photo.calibration
                      ? "Using " +
                        calibrationLabel(photo.calibration.method) +
                        "."
                      : "Use a standard card or a rectangle with measured dimensions already visible on the same flat surface. You can also continue without measurements."}
                  </Copy>
                  <Action
                    label={
                      photo.calibration
                        ? "Change size reference"
                        : "Add size reference"
                    }
                    secondary
                    disabled={busy}
                    onPress={() => {
                      setCalibrating(true);
                      scroll.current?.scrollTo({ y: 0 });
                    }}
                  />
                </Disclosure>
                <Disclosure label="Photo options">
                  <Action
                    label="Use entire photo"
                    secondary
                    disabled={busy}
                    onPress={() => {
                      setStrokes([]);
                      setSelection({
                        x1: 0,
                        y1: 0,
                        x2: photo.width - 1,
                        y2: photo.height - 1,
                      });
                    }}
                  />
                  {!locked ? (
                    <>
                      <Action
                        label="Retake photo"
                        secondary
                        disabled={busy}
                        onPress={() => void choose(true)}
                      />
                      <Action
                        label="Choose a different photo"
                        secondary
                        disabled={busy}
                        onPress={() => void choose(false)}
                      />
                    </>
                  ) : null}
                </Disclosure>
              </Panel>
              <Copy variant="caption" muted>
                Your photo is saved for analysis. Assessments are guidance, not
                a professional inspection.
              </Copy>
            </>
          )}
        </Section>
      )}
      {error && (!photo || calibrating || editing) ? (
        <Notice warning>{error}</Notice>
      ) : null}
    </ScrollView>
  );
}
