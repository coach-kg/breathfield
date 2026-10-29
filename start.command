#!/bin/bash
# Double-click on a Mac to run Breathfield locally.
# Opens it in Chrome when installed, because Bluetooth straps and the USB
# emWave only work in Chrome or Edge. Close this window to stop it.

cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT/"

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

if open -Ra "Google Chrome" 2>/dev/null; then
  open -a "Google Chrome" "$URL"
elif open -Ra "Microsoft Edge" 2>/dev/null; then
  open -a "Microsoft Edge" "$URL"
else
  open "$URL"
fi

echo "Breathfield is running at $URL"
echo "Close this window to stop it."
wait $SERVER
