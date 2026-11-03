# FixLens

FixLens helps homeowners understand a visible problem, decide what to do next, and check whether it changes over time. Take a photo of a crack, stain, or scuff, brush across the affected area, and review the generated outline before requesting an assessment.

## Demo walkthrough

1. Tap **Check a problem** and take or choose a photo. Swipe along a crack or brush across a wider mark. Add a short description if it helps identify the spot.
2. Tap **Preview highlight**. Review the outline with or without shading, and use **Edit highlight** if it needs correction.
3. Tap **Get assessment** to see the likely issue, urgency, and suggested next steps. **Find repair help** opens a search for the relevant trade in Google Maps.
4. Open the saved job and tap **Check again** to photograph the same spot. FixLens reports a change in highlighted area when both captures have comparable measurements.

## What runs where

| Project | Responsibilities |
| --- | --- |
| [Expo app](rct-fixlens/) | Capture, brush and outline review, reports, follow-up photos, and optional device copies |
| [NestJS API](nst-fixlens/) | Upload signing, model calls, safety checks, measurement, and persistence |
| [PostgreSQL 17 schema](nst-fixlens/sql/schema.sql) | Problems, captures, measurements, reports, and a view for capture-to-capture changes |

The phone uploads the photo directly to private DigitalOcean Spaces using a short-lived signed URL. Muse Spark identifies the intended region from the photo, brush, and optional description. SAM segments the region, then the homeowner reviews the outline. Muse produces the assessment after confirmation, and a deterministic safety check removes DIY guidance when it detects a supported hazard.

Physical area estimates require a usable outline and a reference on the same flat surface. When either is missing, FixLens can still provide an assessment from the photo. The app uses a single shared demo user, so run it in a private test environment with sample photos.

## Run locally

Use **Node.js 24.15+**, Docker with Compose, and a private DigitalOcean Spaces bucket. Expo Go on the phone must be compatible with Expo SDK 58.

**API**

```sh
cd nst-fixlens
npm ci
cp .env.example .env
```

Set the `SPACES_*` values for your private bucket and set `SEGMENTATION_SECRET` to a random secret of at least 32 characters. The example database URL matches the local Compose database. `DIAGNOSIS_PROVIDER=mock` produces clearly labeled sample assessments and still uses Spaces for photo upload. To run real inference, set `DIAGNOSIS_PROVIDER=meta` and provide `META_AI_API_KEY` in the server environment.

```sh
docker compose up -d --wait
npm run migration:run
npm run start:dev
```

Check `http://localhost:3000/health`. The migration command above assumes an empty database. See the [API README](nst-fixlens/README.md) for existing database setup and deployment.

**Mobile app**

In a second terminal, from the repository root:

```sh
cd rct-fixlens
npm ci
cp .env.example .env.local
```

Set `EXPO_PUBLIC_API_URL` to your computer’s address on the same Wi-Fi network as the phone, such as `http://192.168.1.10:3000`. Run `npm start` and open its QR code in Expo Go. See the [mobile README](rct-fixlens/README.md) for native builds and the optional size estimate flow.

In PowerShell, use `Copy-Item` in place of `cp`.

## Verify

- API unit tests run with `npm test` in `nst-fixlens/`. PostgreSQL integration tests require a separate empty test database. [API test setup](nst-fixlens/README.md#verification)
- App unit tests run with `npm test` in `rct-fixlens/`. The Playwright suite uses fixture responses to exercise the capture and report flow. [Browser test setup](rct-fixlens/README.md#web-preview-and-checks)
