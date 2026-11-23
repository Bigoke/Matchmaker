#!/bin/sh
# Builds dist/Matchmaker.exe (app) and dist/Matchmaker-Setup.exe (installer). Needs Go and Python.
set -e
cd "$(dirname "$0")"
VER=$(grep -o "APP_VERSION = '[0-9.]*'" src/ui5.js | grep -o "[0-9.]*")
python3 build.py
(cd launcher && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H=windowsgui" -o ../dist/Matchmaker.exe .)
gzip -9 -c dist/Matchmaker.exe > installer/payload.exe.gz
(cd installer && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H=windowsgui -X main.version=$VER" -o ../dist/Matchmaker-Setup.exe .)
ls -la dist
