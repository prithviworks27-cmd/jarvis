#!/bin/bash
# Usage: scripts/autostart.sh on|off   Starts JARVIS at login (and now), or removes that.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.prithviraj.jarvis
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
case "$1" in
  on)
    [ -x "$DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ] || { echo "Run npm install first."; exit 1; }
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron</string>
    <string>$DIR</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/jarvis.log</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/jarvis.log</string>
</dict></plist>
PL
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "JARVIS will now start at login (and is starting now). Logs: ~/Library/Logs/jarvis.log" ;;
  off)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Autostart removed." ;;
  *) echo "Usage: $0 on|off"; exit 1 ;;
esac
