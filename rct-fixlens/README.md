# FixLens mobile

Expo SDK 58 + React Native + Expo Router. The app connects to the Nest backend in `../nst-fixlens` and uses the shared demo home; there is no login.

## Run on a phone with Expo Go

Use Node.js 24. In the backend folder, start Nest (`npm run start:dev`). Then, here:

```sh
npm ci
# PowerShell: Copy-Item .env.example .env.local
cp .env.example .env.local
npm start
```

Set `EXPO_PUBLIC_API_URL` in `.env.local` to your computer's Wi-Fi address, for example `http://192.168.1.10:3000`. Your phone and computer must share a network. `localhost` on the phone points to the phone itself.

Open the QR code in Expo Go (iPhone: Camera; Android: Expo Go scanner). Allow local-network/camera access when prompted. You can also enter `exp://192.168.1.10:8081` in Expo Go. Use a compatible SDK 58 Expo Go version. The image picker, image manipulator, file-system uploader, and native Expo UI controls are included; no custom build is required for this flow. Permission wording from app.json applies to your own builds; Expo Go has its own permission prompts.

Check `http://<computer-ip>:3000/health` from the phone's browser if API requests fail. Windows Firewall may need to allow Node.js on private networks. An Expo tunnel forwards Metro, not the separate Nest API; use a reachable HTTPS API URL when testing away from the local network. No firewall settings are modified by this project.

## Current user flow

1. **Photo:** take a photo or choose one from the library. A supported native development build also offers capture with a size estimate. The home screen prioritizes the capture action and saved problems.
2. **Mark and describe:** brush over the damage and optionally name it in your own words. There is no separate selection-confirmation/context screen. The visible **Describe what to highlight** field guides Muse before segmentation. Location and category live under **More details (optional)**; explicit hazard switches remain available under **Safety concerns**, with a visible count/notice when selected. **Size estimate (optional)** contains reference-card calibration, and **Photo options** contains retake/change/whole-photo actions. Nothing uploads until Preview highlight or the editor's assessment action is used.
3. **Automatic preview:** **Preview highlight** saves/uploads/registers once, runs Muse targeting and cropped SAM with quality checks, and displays the resulting outline. **Get assessment** confirms that visible outline. **Edit highlight** opens Paint/Erase/Undo with zoom/pan; **Adjust description or area** retries targeting using the same uploaded capture. Failed automatic isolation offers a manual outline first, with **Assess photo without measurements** still available.
4. **Manual outline:** **Use my tracing** opens the editor using the user's brush strokes and skips automatic targeting/SAM. **Use outline and assess** is the user's explicit confirmation: it saves the source-sized mask and immediately requests the final assessment, without a second confirmation screen. Cancel preserves the previous preview. A failed outline save retains the strokes; a failed final assessment reuses the successfully saved outline/token on retry. Changed strokes, scale/hazards, cancellation or an expired confirmation invalidate this reuse. Duplicate submissions remain blocked.
5. **Report:** urgency, likely cause, confidence, DIY/pro guidance, warning signs and change summary. Assessment provenance/long confidence notes are under **Assessment details**; optional photo/mask downloads are under **Save a device copy**. Safety overrides and measurement limitations stay visible. Final Muse can still withhold measurements if the outline is unreliable. A drawn outline supplies neither real-world scale nor crack width/depth.
6. **Check again:** capture the same spot under the existing problem; it registers a non-baseline capture. Missing scale or unreliable outlines remain explicitly unmeasured.

The first successful capture of a new problem is its baseline. Images are converted to JPEG and resized to a maximum 2000 px edge with the SDK 58 ImageManipulator API. Saved dimensions describe the uploaded image. `taken_at` currently records when the image is selected/captured in this flow, rather than parsing historical gallery EXIF dates.

Originals live under `captures/`, temporary SAM masks under `previews/`, and confirmed masks under `masks/` in the same private bucket. Postgres keeps object keys and report/measurement data. Only the public API URL lives in the client. Database and Spaces credentials stay on the server; the phone gets a temporary upload URL.

## Loading and retry behavior

Initial loading, empty home, errors, and existing content are separate states. Failed refreshes preserve existing results. Ordinary requests time out after 30 seconds; preview allows 210 seconds for bounded targeting/SAM attempts and final assessment allows 120 seconds. Timeouts show a retry message. Upload/diagnosis progress uses actual completed stages, with no invented percentage.

While submitting, duplicate taps are blocked. Failed attempts keep the photo and context in memory. Preview and assessment are separate steps; previewing never requests a diagnosis. A signed confirmation binds the exact preview to the capture and expires after 15 minutes. An expired highlight must be reviewed again. Redraw reruns Muse targeting and SAM while reusing the original upload. A failed assessment retries Muse with the reviewed mask. Successful stages are reused on retry, including the same capture key after a lost registration response. The API returns the original immutable capture on repeat registration. A lost diagnosis response is checked against the persisted report before asking the user to retry. The draft is not persisted across app termination or leaving the capture screen; a created problem can remain without a report if the flow is abandoned.

## Demo limits

The backend supports real Meta inference with `DIAGNOSIS_PROVIDER=meta`, or mock inference with `DIAGNOSIS_PROVIDER=mock`. The UI labels mock-version results explicitly. Real photos are still uploaded to the configured private bucket and real records are saved. Follow-up captures guide the user to match framing. Automatic alignment and scheduled reminders are future work. A suggested recheck date does not schedule a notification.

## Web preview and checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:browser
npx expo export --platform ios --platform android
npm run web
```

Browser tests export the production web bundle and serve it on port 8082, with API/storage responses intercepted. They cover photo selection, freehand brush paths, undo/clear, source coordinates and foreground samples, SAM highlight confirmation, redraw, context, safety flags, direct PUT, report rendering, saved-home navigation, and failure/retry without duplicate captures. Windows uses the installed Edge browser; other platforms use Playwright Chromium (`npx playwright install chromium`). Override `PLAYWRIGHT_CHANNEL` to choose another installed browser.

The Nest API permits localhost web origins on 8081 and 8082. For other origins set its comma-separated `CORS_ORIGINS`. Spaces also needs bucket CORS allowing GET, PUT, and Content-Type for the browser origin. Native Expo Go uploads do not use browser CORS.

The phone's actual camera permissions, painting versus scroll gestures, portrait/landscape rotation, keyboard layout, and native SwiftUI/Compose controls must still be exercised on device; browser tests and bundle compilation do not replace that check. See the [SDK 58 docs](https://docs.expo.dev/versions/v58.0.0/) for the package APIs.

## Optional device copies

On a saved report, tap **Save photo and mask**. This requests add-only photo permission when needed and saves the unmarked assessment JPEG and a separate transparent PNG mask to Photos/gallery. It exports the prepared photo stored in Spaces; it does not alter or remove the original camera image. The mask is a 2D image, not a 3D mesh. Mock reports have no real mask and offer Save photo only.

The app requests fresh signed URLs for that report's capture, downloads directly from the private bucket, adds assets using SDK 58 `Asset.create`, and removes temporary cache files. The action does not invoke SAM or Muse. If one asset succeeds and the next fails, retry on this screen writes only the missing asset; the report remains usable. Permission denial shows a retry message and a Settings action when the OS blocks further prompts. Save progress is kept in memory during this screen visit, not across app termination/navigation.

On web the action starts two downloads instead of accessing a photo library. Some browsers require allowing multiple downloads. Browser success means a download was initiated; disk-save confirmation is controlled by the browser. `expo-media-library` is bundled in SDK 58 Expo Go; custom permission wording in app.json applies to a rebuilt standalone/development app, while Expo Go supplies its own wording. The add-only request uses an empty read-permission list, avoiding Expo Go Android's restricted full-library access. Real permission prompts and Photos/gallery writes still require phone testing.

## Optional size estimates

The backend must first have `../nst-fixlens/sql/002-calibration.sql` applied as its table owner (`doadmin` for the current managed database) and be restarted with this version. Older saved reports remain uncalibrated.

**Expo Go / any phone / existing photos:** open **Size estimate (optional) → Add size reference**. Choose **Standard card** for a visible bank-size plastic card (85.60 × 53.98 mm), or **Known-size rectangle** for another visible rectangle whose actual dimensions you can measure, such as a tile. For a custom rectangle choose millimeters, centimeters or inches and enter its width and height. Tap four corners in order: edge 1 → 2 is the width and edge 2 → 3 is the height; for a standard card, start with a long edge. Confirm that the reference lies on the same flat surface as the damage. Undo/Clear are available; editing an existing reference restores its corners and dimensions. Each side must be 10–2000 mm. Invalid dimensions and crossed corners preserve the draft and upload nothing. Rounded/tiny/partly hidden references or guessed nominal dimensions are unsuitable. If the photo contains no usable reference, continue without measurements; AR cannot retroactively supply scale. No additional model call or native build is needed for this calibration flow.

Custom references use `method: known_rectangle` and canonical millimeter dimensions. The backend computes the same perspective-correct planar homography as the card flow, signs it in the preview receipt and persists it in the existing calibration JSON. Reports identify the source as a measured rectangle, not AR. This needs no new SQL migration. Surface area remains approximate; crack width/depth are not measured. Automatic reference detection and a two-point ruler are not implemented.

**Native development build:** **Take a photo with size estimate** appears when the local module and device support surface tracking. Slowly scan the wall/floor, aim the crosshair at the damage, then Capture surface. iOS uses ARKit world tracking and existing-plane raycasts, enabling scene depth on LiDAR devices when available. Android uses ARCore plane hit tests, enables Depth when supported, and handles the AR service installation prompt. Both save a JPEG from the same AR frame used for plane projection; gallery images never inherit unrelated AR geometry. Camera permission is requested only when opening capture. Unavailable tracking has a cancel/reference-card fallback. The Android capture screen includes Google's AR privacy disclosure/link; no Cloud Anchors or Geospatial services are used.

The native module lives in `modules/fixlens-measurement`. Android uses ARCore 1.54.0 and is optional for app installation; other flows work without it. Generated root native projects stay ignored. The module's Android code and merged app manifest compile locally. iOS Swift needs an Xcode/EAS build; neither platform's physical accuracy or real camera lifecycle has been validated on a phone yet.

```sh
# Keep existing Expo Go workflow (reference-card option)
npm start
# Local Android development build; requires JDK/Android SDK
npm run android
# Native development build Metro server
npm run start:dev-client
# iPhone from Windows: sign in/link the Expo project and register your device first
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile development
```

`eas.json` includes an internal development-client profile. `com.fixlens.app` is the current development bundle/package ID; choose your final owned ID before store distribution. No EAS project, signing credentials, cloud build, or store submission was created automatically.

The app scales native reference points together with the prepared JPEG, sends optional calibration only with segmentation, and displays approximate highlighted area in cm² on the report only after the final mask review accepts it. The backend stores the reference/transform/quality with the committed measurement. Pixel counts keep their original meaning. These estimates do not measure narrow crack width, displacement or hidden damage; a poor mask, oblique image, curved surface, or inaccurate corner tap can give a poor estimate. A later photo needs its own calibration. Cross-method comparisons are withheld. Native device copies still export an unmarked JPEG and 2D transparent mask, not a 3D mesh.

## Describing the intended mark

Before **Preview highlight**, **Describe what to highlight (optional)** accepts a free-text description alongside the short problem name and brush. Describe color, shape, location and surrounding areas to leave out, for example “Thin gray scuff near the light, not the whole ceiling.” The existing `context` payload sends this to Muse before it proposes the crop and foreground/exclusion points for SAM; the final assessment receives the same description. SAM still produces the segmentation mask.

From a preview, **Adjust description or area** lets the user refine the description and/or brush, then prepare another preview using the existing uploaded photo and capture. The description remains editable after an unsuccessful preview. Empty descriptions are allowed; descriptions do not establish scale or override visual mask checks. No schema migration or additional model call is required.

## Finding repair professionals

Reports include **Find repair help**. The sheet suggests the assessment's professional trade; users can edit it and optionally enter a city or ZIP/postal code. Generic trades use the report category or flagged specialty as a fallback. Room notes such as “Basement” are never used as a geographic address. The form preserves its draft when canceled or when opening Maps fails.

**Open results in Google Maps** sends only the visible repair type and search area to [Google Maps search](https://developers.google.com/maps/documentation/urls/get-started), where business listings and the map appear. With no area, the query asks for nearby results; Maps controls its own location access. FixLens requests no location permission, stores no search area, shares no photo/report/job ID, makes no extra model call and contacts no business. No new dependency, API key, backend endpoint or native build is required. Listings are supplied by Maps and are not vetted by FixLens. Search results currently open in the Maps app or browser; an in-app business list and embedded map would need a places-data integration.

## Saved-job management

Home shows photo thumbnails, urgency badges, saved-job counts, search and attention/monitoring filters. Reports include the saved photo and an optional damage-outline overlay. Shared color/surface tokens support light and dark appearance.

Tap **Delete** on a saved-job card, or **Delete job and cloud files** under a report's **Manage job** section. A confirmation sheet names the job and explains removal before sending a request. Cancellation sends nothing. Confirmed deletion removes the job's reports, measurements, captures and cloud originals/outlines/previews; already saved device copies remain. Failures keep the sheet retryable. Accepted cleanup may continue in the background after the job disappears from the list.

**Manage cloud files** shows per-job file counts and approximate stored size. **Clear temporary previews** has a separate confirmation and preserves original photos, committed outlines and reports. Current in-progress highlights may need another preview afterward. This uses the backend's owner-scoped storage/deletion endpoints; update and restart the API along with this client. No new dependencies or native build are required. Because authentication is still deferred, all demo clients share the same jobs.
