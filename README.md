# Mobile Release Pipeline

This repository builds a source mobile application into signed iOS and Android release artifacts.

The source repository is selected through `SOURCE_REPO` and `SOURCE_REPO_PAT`; no application source is copied here. Store credentials and signing material are injected through protected GitHub environments.

## Required repository variables

```text
SOURCE_REPO=owner/source-repository
APP_PACKAGE_ID=ai.readmex.app
IOS_APP_BUNDLE_ID=ai.readmex.app
```

## Required secrets

```text
SOURCE_REPO_PAT
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64
IOS_DISTRIBUTION_CERT_BASE64
IOS_CERT_PASSWORD
IOS_KEYCHAIN_PASSWORD
IOS_PROFILE_APP_BASE64
APPLE_TEAM_ID
ASC_API_KEY_P8_BASE64
ASC_KEY_ID
ASC_ISSUER_ID
FEISHU_RELEASE_WEBHOOK_URL
FEISHU_RELEASE_WEBHOOK_SECRET
```

Workflows build artifacts first. Store submission is disabled by default and requires an explicit workflow input.

## iOS release and notifications

The iOS workflow selects Xcode 26.3, creates a signed IPA, and preserves it as a 14-day Actions artifact. With `submit=true`, it authenticates with App Store Connect, resolves the app by `IOS_APP_BUNDLE_ID`, uploads the IPA, and checks Apple's processing state for up to 10 minutes. An accepted upload can still be processing; it does not publish an App Store release or submit a review.

The pinned GTSDK 3.1.2.0 and GTCommonSDK 3.2.6.0 binary frameworks omit the version key required by Apple. Before export, the workflow fills only the missing vendor version metadata, signs the modified frameworks and containing app, and verifies the signatures. It rejects changed SDK pins. Upload success requires an explicit positive Apple receipt; an altool exit code of 0 alone is insufficient.

The independent `notify` job runs even when source checkout, signing, archive, export, or submission fails. Its card includes the version, build number, exact source commit, IPA artifact, Actions logs, upload result, and the discovered TestFlight URL. A notification is successful only when HTTP succeeds and Feishu returns code 0. Notification failure is visible in its own job and does not change the IPA artifact.

Configure the signed bot's URL and secret with `FEISHU_RELEASE_WEBHOOK_URL` and `FEISHU_RELEASE_WEBHOOK_SECRET`. The truncated legacy name `FEISHU_RELEASE_WEBHOOK_SECRE` is accepted as a fallback. Never commit webhook values or Apple keys. Optional variable `FEISHU_RELEASE_LANG=zh` selects Chinese; absent or unsupported values default to English.

From the ReadmeX source workspace:

```sh
npm run pipeline:release -- --platform ios --ref <pushed-source-SHA> --version 1.0.0 --build-number 2 --submit --watch
```

Choose a build number higher than the last uploaded one. `version:update` is separate and is not required to build an existing version. Pipeline version/signing preparation only modifies the disposable CI checkout.

## Interactive source entry

From the ReadmeX repository, run `npm run pipeline:interactive` (or `npm run pipeline:release` without arguments in a terminal). Select iOS or Android, then AAB, APK, or both. Enter a pushed source ref, native app version and a new build number. Store submission and R2 publishing are explicit choices; version updates are independent. Set `READMEX_RELEASE_LANG=zh` for the Chinese menu. `READMEX_PIPELINE_GH_USER` optionally selects a locally authenticated GitHub account without switching the global account.

## Android AAB and APK

The Android workflow accepts `artifact_type=aab|apk|both`. It restores the upload keystore, validates signed AAB/APK output, checks 16 KB ELF/ZIP compatibility and preserves each artifact separately for 14 days. `clear_cache=true` disables Gradle cache for that run. Source checkout must include the source repository's `scripts/check-android-page-size.py` and native compatibility fix.

AAB submission and APK distribution run independently after the build. A failed Play upload does not block R2, and a failed R2 publication does not block Play. The final Feishu job always reports build, submission and distribution outcomes, exact source SHA, available artifacts and verified public download links. Notification success requires HTTP success and Feishu code 0.

`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` is decoded to a temporary private JSON file for the Play action and cleaned up afterwards. Preflight validates OAuth and opens/deletes an unpublished edit to check package access. New apps require one manual signed AAB upload in Play Console. `release_status` defaults to `draft`; select `completed` to publish to the chosen track (default `internal`). A successful upload does not mean a production review was approved.

## R2 APK distribution and latest cache

Configure these repository secrets (public URL/prefix may alternatively be repository variables):

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_BASE_URL
R2_OBJECT_PREFIX=readmex/app-update
```

Enable `publish_apk=true` for APK or both. The selected prefix receives:

- `readmex-<version>-<build>.apk`: public, one-year immutable cache.
- `readmex-latest.apk`: overwritten after the versioned download is verified; `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`.

The uploader checks expected ETag/size, HTTP 200 and Range 206 for both URLs. It rejects latest responses with a cache HIT or missing no-store directive, rather than advertising stale bytes. Failed public verification leaves Actions artifacts available.

With the provided configuration, latest is `https://cdn.ottermind.ai/readmex/app-update/readmex-latest.apk`. In the Cloudflare zone, add a Cache Rule matching:

```text
(http.host eq "cdn.ottermind.ai" and http.request.uri.path eq "/readmex/app-update/readmex-latest.apk")
```

Set cache eligibility to **Bypass cache** and place this rule after broader conflicting cache rules. Purge this exact URL once to remove any previously cached object. Keep versioned APK URLs cacheable. If a Worker fronts the bucket, it must preserve the object's HTTP metadata and honor this bypass policy.

Verify the actual published response:

```sh
curl -I https://cdn.ottermind.ai/readmex/app-update/readmex-latest.apk
curl -sS -D - -H 'Range: bytes=0-0' https://cdn.ottermind.ai/readmex/app-update/readmex-latest.apk -o /dev/null
```

Expect HTTP 200 with no-store and no cache HIT for HEAD, and HTTP 206 with Content-Range for the range request. Cloudflare instructions: [Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/create-dashboard/) and [Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/).
