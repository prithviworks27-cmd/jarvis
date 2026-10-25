// Prints "double" to stdout when the Control key is tapped twice quickly (like Siri's double-tap Command).
// Needs Accessibility access for the app that launches it; macOS prompts on first run.
import Cocoa

let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(opts) {
  FileHandle.standardError.write("Allow Accessibility access for Electron/your terminal in System Settings > Privacy & Security, then restart JARVIS.\n".data(using: .utf8)!)
}

var controlDown = false, dirty = false
var downAt: TimeInterval = 0, lastTap: TimeInterval = 0

// Any other key while Control is held (Ctrl+C, Ctrl+letters) means it's a chord, not a tap.
NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { _ in dirty = true }
NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { e in
  let f = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
  if f == [.control] && !controlDown {
    controlDown = true; dirty = false; downAt = e.timestamp
  } else if controlDown && !f.contains(.control) {
    controlDown = false
    guard !dirty, f.isEmpty, e.timestamp - downAt < 0.3 else { lastTap = 0; return }
    if e.timestamp - lastTap < 0.4 {
      print("double"); fflush(stdout); lastTap = 0
    } else {
      lastTap = e.timestamp
    }
  } else if controlDown && f != [.control] {
    dirty = true // Control + another modifier
  }
}

NSApplication.shared.setActivationPolicy(.prohibited)
NSApplication.shared.run()
