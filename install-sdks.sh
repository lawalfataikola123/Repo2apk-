#!/bin/bash
set -e

SDK_DIR="$(pwd)/sdks"
mkdir -p "$SDK_DIR"

echo "Starting SDK installation in $SDK_DIR..."

if [ ! -d "$SDK_DIR/java" ]; then
  echo "Downloading OpenJDK 17..."
  wget -qO- "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_linux_hotspot_17.0.10_7.tar.gz" | tar -xz -C "$SDK_DIR"
  mv "$SDK_DIR"/jdk-17* "$SDK_DIR/java"
else
  echo "Java already installed."
fi

export JAVA_HOME="$SDK_DIR/java"
export PATH="$JAVA_HOME/bin:$PATH"

if [ ! -d "$SDK_DIR/android" ]; then
  echo "Downloading Android SDK Command Line Tools..."
  mkdir -p "$SDK_DIR/android/cmdline-tools"
  wget -q "https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip" -O "$SDK_DIR/cmdline-tools.zip"
  unzip -q "$SDK_DIR/cmdline-tools.zip" -d "$SDK_DIR/android/cmdline-tools"
  mv "$SDK_DIR/android/cmdline-tools/cmdline-tools" "$SDK_DIR/android/cmdline-tools/latest"
  rm "$SDK_DIR/cmdline-tools.zip"
else
  echo "Android SDK already installed."
fi

export ANDROID_HOME="$SDK_DIR/android"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

echo "Accepting Android licenses..."
yes | sdkmanager --licenses || true

echo "Installing Android platform tools and build tools..."
sdkmanager "platform-tools" "platforms;android-33" "build-tools;33.0.2" || true

if [ ! -d "$SDK_DIR/flutter" ]; then
  echo "Downloading Flutter SDK..."
  git clone -b stable https://github.com/flutter/flutter.git "$SDK_DIR/flutter"
else
  echo "Flutter SDK already installed."
fi

echo "SDKs installed successfully!"
