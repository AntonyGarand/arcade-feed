# Android app (F-Droid / GitHub releases)

A [Capacitor](https://capacitorjs.com) app that ships `dist/` inside the APK, so it works offline and
needs no particular browser. Package ID `dev.garand.arcade.foss`. It is listed on the F-Droid repo at
https://fdroid.garand.dev (repo AntonyGarand/fdroid).

The WebView serves the bundled files as `https://arcade.garand.dev` (`capacitor.config.json`), so
storage and analytics behave like the website. Analytics events carry `app.platform = android`,
and players can turn them off in Settings. The service worker and source maps are left out
(`vite build --mode android`).

## Updates

The game files are inside the APK, so every change (games or native) reaches the app through a new
release. The app doesn't download new builds from the site.

## Release

Push a `vX.Y.Z` tag on `main`. `.github/workflows/android-release.yml` builds and signs the APK
(versionCode `X*10000 + Y*100 + Z`) and attaches it to a GitHub release. The F-Droid repo picks it up
on its next run (every 6 hours, or `gh workflow run publish.yml -R AntonyGarand/fdroid`).

## Local build

Needs JDK 21+ (`JAVA_HOME`) and the Android SDK (`ANDROID_HOME`).

```sh
npm run build:android                 # vite build --mode android && cap sync android
cd android-foss && ./gradlew assembleRelease -PversionCode=1 -PversionName=0.0.1
```

To sign, set `ANDROID_KEYSTORE` (path) and `ANDROID_KEYSTORE_PASSWORD`. Without them the APK is
unsigned. The release key is `~/.secrets/arcade-feed-foss-release.jks` (alias `release`), with its
password in `~/.secrets/ARCADE_FEED_FOSS_KEYSTORE_PASSWORD`. CI has both as the secrets
`ANDROID_FOSS_KEYSTORE_B64` and `ANDROID_FOSS_KEYSTORE_PASSWORD`. **Losing this key means users
can't update**: every installed copy is tied to it.

The launcher icons and splash in `app/src/main/res` are resized from `public/icons/`.
