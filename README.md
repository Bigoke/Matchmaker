# Matchmaker

Match intercompany loans across any number of entities' trial balances, reconcile ledgers and statements, and export journals (including your own custom CSV/Excel layouts) for your accounting software. Runs 100% offline – nothing is uploaded.

## Use it
- **Windows app:** download `dist/Matchmaker.exe` and double-click. It opens Matchmaker in its own window (needs Microsoft Edge or Google Chrome, already on most PCs). Windows SmartScreen may warn because the file is unsigned – choose *More info → Run anyway*.
- **Any computer:** open `dist/Matchmaker.html` in a browser.

## Build
```
python3 build.py                     # src/ -> dist/Matchmaker.html (+ launcher copy)
cd launcher && GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H=windowsgui" -o ../dist/Matchmaker.exe .
```
A GitHub Action (`.github/workflows/build.yml`) rebuilds both on every push.

## Test
`node tests/audit1.js` (engine) and `node tests/audit2.js` (browser, needs Playwright). OCR tests (`tests/ocr_learn.js`) need the launcher running; scanned documents are read only in the Windows app.
