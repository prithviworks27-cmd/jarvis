// Reads and drives Discord's voice controls through the macOS accessibility tree. Electron apps only expose it after
// AXManualAccessibility is set, and only while the window is showing, so the caller brings Discord to the front first.
//   state                         muted=yes|no deafened=yes|no incall=yes|no
//   set mute|deafen yes|no        press the switch only if it is not already in that state; prints the state after
//   disconnect                    press "Disconnect" (leave the voice call)
// Exits 0 on success, 2 when a control was not found (window hidden, or not in a call for disconnect), 1 on other problems.
import Cocoa
import ApplicationServices

func attr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: CFTypeRef?; return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v as AnyObject? : nil }
func str(_ e: AXUIElement, _ a: String) -> String { (attr(e, a) as? String) ?? "" }

guard AXIsProcessTrusted() else { FileHandle.standardError.write("Accessibility access is needed.\n".data(using: .utf8)!); exit(1) }
guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "com.hnc.Discord" || $0.localizedName == "Discord" }) else { print("not running"); exit(2) }
let root = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)

// Finds the first element whose description equals `desc` (role-filtered), waiting a moment for the tree to build.
func find(_ desc: String, roles: [String]) -> AXUIElement? {
  func walk(_ e: AXUIElement, _ d: Int) -> AXUIElement? {
    if d > 60 { return nil }
    if roles.contains(str(e, "AXRole")), str(e, "AXDescription") == desc { return e }
    for k in (attr(e, "AXChildren") as? [AXUIElement]) ?? [] { if let r = walk(k, d + 1) { return r } }
    return nil
  }
  for _ in 0..<12 { if let r = walk(root, 0) { return r }; usleep(250_000) }
  return nil
}
func isOn(_ e: AXUIElement) -> Bool { if let n = attr(e, "AXValue") as? NSNumber { return n.intValue != 0 }; return str(e, "AXValue") == "1" }

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "state":
  guard let mute = find("Mute", roles: ["AXCheckBox"]), let deafen = find("Deafen", roles: ["AXCheckBox"]) else { print("controls not found (Discord window hidden?)"); exit(2) }
  print("muted=\(isOn(mute) ? "yes" : "no")")
  print("deafened=\(isOn(deafen) ? "yes" : "no")")
  print("incall=\(find("Disconnect", roles: ["AXButton"]) != nil ? "yes" : "no")")
case "set":
  guard args.count > 3, let sw = find(args[2] == "mute" ? "Mute" : "Deafen", roles: ["AXCheckBox"]) else { print("control not found"); exit(2) }
  let want = args[3] == "yes"
  if isOn(sw) != want { _ = AXUIElementPerformAction(sw, "AXPress" as CFString); usleep(400_000) }
  print("\(args[2])=\(isOn(sw) ? "yes" : "no")")
case "disconnect":
  guard let b = find("Disconnect", roles: ["AXButton"]) else { print("not in a call"); exit(2) }
  print(AXUIElementPerformAction(b, "AXPress" as CFString) == .success ? "disconnected" : "failed")
default:
  FileHandle.standardError.write("usage: discord state|set|disconnect\n".data(using: .utf8)!); exit(1)
}
