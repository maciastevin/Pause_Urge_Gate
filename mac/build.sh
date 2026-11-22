#!/bin/bash
# Builds Pause.app (universal, ad-hoc signed). Needs Xcode or the Command Line Tools.
#   ./mac/build.sh        → mac/build/Pause.app and mac/build/Pause-mac.zip
set -euo pipefail
cd "$(dirname "$0")"
OUT=build/Pause.app
rm -rf build
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

for arch in arm64 x86_64; do
  xcrun swiftc -O -target "$arch-apple-macos12.0" \
    -framework Cocoa -framework WebKit -framework ServiceManagement \
    Sources/*.swift -o "build/Pause-$arch"
done
lipo -create build/Pause-arm64 build/Pause-x86_64 -output "$OUT/Contents/MacOS/Pause"

cp Info.plist "$OUT/Contents/Info.plist"
cp -R ../browser-extension/gate "$OUT/Contents/Resources/gate"
iconutil -c icns AppIcon.iconset -o "$OUT/Contents/Resources/AppIcon.icns"

codesign --force --deep --sign - "$OUT"
(cd build && ditto -c -k --keepParent Pause.app Pause-mac.zip)
echo "Built $(pwd)/$OUT"
