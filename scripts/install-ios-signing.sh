#!/usr/bin/env bash
set -euo pipefail

require_env() {
  test -n "${!1:-}" || { echo "Missing required secret: $1" >&2; exit 1; }
}

require_env IOS_DISTRIBUTION_CERT_BASE64
require_env IOS_CERT_PASSWORD
require_env IOS_KEYCHAIN_PASSWORD
require_env IOS_PROFILE_APP_BASE64

mkdir -p .private "$HOME/Library/MobileDevice/Provisioning Profiles"
printf '%s' "$IOS_DISTRIBUTION_CERT_BASE64" | base64 --decode > .private/distribution.p12
printf '%s' "$IOS_PROFILE_APP_BASE64" | base64 --decode > .private/app.mobileprovision

KEYCHAIN_PATH="${RUNNER_TEMP}/mobile-signing.keychain-db"
security create-keychain -p "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import .private/distribution.p12 -P "$IOS_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security list-keychains -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | sed 's/"//g')
security default-keychain -s "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

PROFILE_PLIST=.private/app-profile.plist
security cms -D -i .private/app.mobileprovision > "$PROFILE_PLIST"
PROFILE_UUID=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$PROFILE_PLIST")
PROFILE_NAME=$(/usr/libexec/PlistBuddy -c 'Print Name' "$PROFILE_PLIST")
cp .private/app.mobileprovision "$HOME/Library/MobileDevice/Provisioning Profiles/${PROFILE_UUID}.mobileprovision"

echo "keychain_path=$KEYCHAIN_PATH" >> "$GITHUB_OUTPUT"
echo "profile_name=$PROFILE_NAME" >> "$GITHUB_OUTPUT"
echo "[prepare] iOS signing material installed"
