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
PLAY_SERVICE_ACCOUNT_JSON
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

The independent `notify` job runs even when source checkout, signing, archive, export, or submission fails. Its card includes the version, build number, exact source commit, IPA artifact, Actions logs, upload result, and the discovered TestFlight URL. A notification is successful only when HTTP succeeds and Feishu returns code 0. Notification failure is visible in its own job and does not change the IPA artifact.

Configure the signed bot's URL and secret with `FEISHU_RELEASE_WEBHOOK_URL` and `FEISHU_RELEASE_WEBHOOK_SECRET`. The truncated legacy name `FEISHU_RELEASE_WEBHOOK_SECRE` is accepted as a fallback. Never commit webhook values or Apple keys. Optional variable `FEISHU_RELEASE_LANG=zh` selects Chinese; absent or unsupported values default to English.

From the ReadmeX source workspace:

```sh
npm run pipeline:release -- --platform ios --ref <pushed-source-SHA> --version 1.0.0 --build-number 2 --submit --watch
```

Choose a build number higher than the last uploaded one. `version:update` is separate and is not required to build an existing version. Pipeline version/signing preparation only modifies the disposable CI checkout.
