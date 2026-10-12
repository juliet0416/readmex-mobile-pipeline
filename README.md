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

Configure the signed bot's URL and secret with `FEISHU_RELEASE_WEBHOOK_URL` and `FEISHU_RELEASE_WEBHOOK_SECRET`. The truncated legacy name `FEISHU_RELEASE_WEBHOOK_SECRE` is accepted as a fallback. Never commit webhook values or Apple keys. Workflow notifications default to Chinese (`FEISHU_RELEASE_LANG=zh`); set `en` explicitly for English. APK links distinguish the GitHub artifact ZIP (repository access, 14-day retention), the public versioned R2 APK, and the fixed latest APK URL. Play track/status copy is translated too.

From the ReadmeX source workspace:

```sh
npm run pipeline:release -- --platform ios --ref <pushed-source-SHA> --version 1.0.0 --build-number 2 --submit --watch
```

Omit `--build-number` to resolve the next number in CI from the store, native source and Actions artifact history. An explicit override must be higher than the last upload. `version:update` is separate and is not required to build an existing version. Pipeline version/signing preparation only modifies the disposable CI checkout.

## Interactive source entry

From the ReadmeX repository, install dependencies with Node.js 22.13+ and run `npm run pipeline:release`. The wizard defaults to Chinese and follows Ottermind: platform → source tag → Android artifacts → store submission → cache clearing → confirmation. Arrow keys choose single options; Space toggles aab/APK with [✓]/[ ] markers. Every later step includes a back row; Enter on that row goes back immediately without selecting it. Custom version input accepts b to go back. Existing answers are preserved when stepping backwards.

The wizard uses internal/draft for Google Play, automatically publishes selected APKs to R2 and watches the run. Build numbers are resolved in CI using the maximum of store uploads, native source and Actions artifacts plus one; API failures stop rather than guessing. The workflows serialize per platform to avoid simultaneous store-number allocation. Explicit CLI flags remain available for track/status, build-number and distribution overrides. The new annotated mobile-vX.Y.Z tag is pushed only after confirmation and from a clean commit; an existing tag can be reused. READMEX_RELEASE_LANG=en selects English. READMEX_PIPELINE_GH_USER selects a locally authenticated account without changing global gh auth; otherwise the logged-in pipeline owner is preferred when no token is supplied. CI keeps tag refs and validates expected_source_sha. Android run names and Feishu titles distinguish AAB, APK, and AAB + APK; an automatic run name shows 自动, while artifact filenames and notifications show the actual resolved number.

## Android AAB and APK

The Android workflow accepts `artifact_type=aab|apk|both`. It restores the upload keystore, validates signed AAB/APK output, checks 16 KB ELF/ZIP compatibility and preserves each artifact separately for 14 days. `clear_cache=true` disables Gradle cache for that run. Source checkout must include `scripts/mobile-release/check-android-page-size.py` and the native compatibility fix; older release refs with the original `scripts/check-android-page-size.py` are also supported. Source entry scripts and tests live together under `scripts/mobile-release/`; usage and release logic are documented in `docs/app-store/README.md`.

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
