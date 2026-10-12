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
```

Workflows build artifacts first. Store submission is disabled by default and requires an explicit workflow input.
