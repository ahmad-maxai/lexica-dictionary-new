#!/usr/bin/env bash
set -e

DIR="/app/applet"
JDK_DIR="$DIR/.jdk-21"
SDK_DIR="$DIR/.android-sdk"

echo "=== [1/5] Setting up Portable JDK 21 in persistent storage ==="
if [ ! -f "$JDK_DIR/bin/java" ]; then
  mkdir -p "$JDK_DIR"
  echo "Downloading Eclipse Temurin OpenJDK 21..."
  curl -sL "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jdk_x64_linux_hotspot_21.0.6_7.tar.gz" | tar -xz -C "$JDK_DIR" --strip-components=1
fi

export JAVA_HOME="$JDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"
echo "Java Version: $($JAVA_HOME/bin/java -version 2>&1 | head -n 1)"

echo "=== [2/5] Setting up Android Commandline Tools ==="
mkdir -p "$SDK_DIR/cmdline-tools"
if [ ! -f "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  curl -sL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/cmdline-tools.zip
  rm -rf /tmp/cmdline-tools "$SDK_DIR/cmdline-tools/latest"
  mkdir -p /tmp/cmdline-tools
  unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools
  mv /tmp/cmdline-tools/cmdline-tools "$SDK_DIR/cmdline-tools/latest"
  rm -rf /tmp/cmdline-tools.zip /tmp/cmdline-tools
fi
chmod -R +x "$SDK_DIR/cmdline-tools"

export ANDROID_HOME="$SDK_DIR"
mkdir -p "$SDK_DIR/licenses"
printf "24333f8a63b6825ea9c5514f83c2829b004d1fee\nd56f5187479451eabf01fb78af6dfcb131a6481e\n24333f8a63b6825ea9c5514f83c2829b004d1fee" > "$SDK_DIR/licenses/android-sdk-license"
printf "84831b9409646a918e30573bab4c9c91346d8abd" > "$SDK_DIR/licenses/android-sdk-preview-license"

echo "=== [3/5] Installing Android Platform 36 & Build-Tools ==="
if [ ! -d "$SDK_DIR/platforms/android-36" ]; then
  yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" "platforms;android-36" "build-tools;35.0.0" "platform-tools"
fi

echo "sdk.dir=$SDK_DIR" > "$DIR/android/local.properties"

echo "=== [4/5] Syncing Web Assets to Android Project ==="
cd "$DIR"
npm run build
npx cap sync android

echo "=== [5/5] Building Native Debug APK via Gradle ==="
cd "$DIR/android"
chmod +x gradlew
./gradlew assembleDebug --no-daemon

mkdir -p "$DIR/public"
cp "$DIR/android/app/build/outputs/apk/debug/app-debug.apk" "$DIR/public/lexica-debug.apk"
echo "=== COMPLETED: APK built successfully ==="
ls -lh "$DIR/public/lexica-debug.apk"
