// Reads and drives WhatsApp (the Mac app) through the macOS accessibility tree, instead of guessing from pixels.
// Every chat row carries the chat's exact name and answers "press"; the open chat's title, the message box and the send button
// are named elements too. Prints plain lines; exits 0 on success, 2 when something was not found, 1 on other problems.
//   state                      title=, status=, draft=, send=yes|no, search=, searching=yes|no (search overlay covering the list)
//   rows                       one line per chat the list or the search results show (the list rows are hidden while searching=yes): kind \t section \t name \t preview
//   press <kind> <section> <name>   press the row (kind list|result; section "" = any) whose name is exactly <name>
//   click-composer             click the message box so it has the keyboard
//   focus-composer             (accessibility focus only: not enough to type)
//   press-send                 press the send button (only exists while the box holds text)
//   clear-search               press the search box's "Clear text" button
import Cocoa
import ApplicationServices

func attr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: CFTypeRef?; return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v as AnyObject? : nil }
// Invisible direction marks WhatsApp puts around names and values.
func clean(_ s: String) -> String { s.unicodeScalars.filter { ![0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069].contains($0.value) }.map(String.init).joined() }
func text(_ e: AXUIElement, _ a: String) -> String { clean((attr(e, a) as? String) ?? "") }
func pos(_ e: AXUIElement) -> CGPoint? {
  guard let v = attr(e, "AXPosition"), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
  var p = CGPoint.zero; AXValueGetValue(v as! AXValue, .cgPoint, &p); return p
}

guard AXIsProcessTrusted() else { FileHandle.standardError.write("Accessibility access is needed.\n".data(using: .utf8)!); exit(1) }
guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "net.whatsapp.WhatsApp" }) else { print("not running"); exit(2) }
let root = AXUIElementCreateApplication(app.processIdentifier)
guard let window = (attr(root, "AXWindows") as? [AXUIElement])?.first else { print("no window"); exit(2) }

struct Row { let kind: String; let section: String; let name: String; let preview: String; let el: AXUIElement }
var rows: [Row] = []
var byId: [String: AXUIElement] = [:]
var splitterX: CGFloat = .greatestFiniteMagnitude
var pending: [(kind: String, section: String, el: AXUIElement)] = []
var section = ""
var searching = false // the search overlay (results, or suggestion chips such as Photos/GIFs) is covering the chat list
let chipNames: Set<String> = ["Photos", "Videos", "Links", "GIFs", "Documents", "Audio", "Polls"]

func walk(_ e: AXUIElement, _ depth: Int) {
  if depth > 24 { return }
  let role = (attr(e, "AXRole") as? String) ?? ""
  let id = (attr(e, "AXIdentifier") as? String) ?? ""
  let desc = text(e, "AXDescription")
  if !id.isEmpty && byId[id] == nil { byId[id] = e }
  if role == "AXSplitter", let p = pos(e) { splitterX = p.x }
  if role == "AXHeading", !desc.isEmpty { section = desc }
  if desc == "Search results" || id == "TokenizedSearchBar_DeleteButton" || (role == "AXButton" && id.isEmpty && chipNames.contains(desc)) { searching = true }
  if id == "ChatListSearchView_ChatResult" { rows.append(Row(kind: "result", section: section, name: desc, preview: text(e, "AXValue"), el: e)) }
  else if id.isEmpty, (role == "AXButton" || role == "AXStaticText"), !desc.isEmpty, !text(e, "AXValue").isEmpty { pending.append((kind: "list", section: "", el: e)) }
  // A message bubble holds no chat rows; skip its insides.
  if id == "ChatMessagesTableView" { return }
  for k in (attr(e, "AXChildren") as? [AXUIElement]) ?? [] { walk(k, depth + 1) }
}
walk(window, 0)
// List rows are the unnamed rows on the left of the splitter (everything on the right is the open chat).
for p in pending { if let at = pos(p.el), at.x < splitterX { rows.append(Row(kind: "list", section: "", name: text(p.el, "AXDescription"), preview: text(p.el, "AXValue"), el: p.el)) } }

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "state":
  let header = byId["NavigationBar_HeaderViewButton"]
  print("title=\(header.map { text($0, "AXDescription") } ?? "")")
  print("status=\(header.map { text($0, "AXValue") } ?? "")")
  print("draft=\(byId["ChatBar_ComposerTextView"].map { text($0, "AXValue") } ?? "")")
  print("send=\(byId.keys.contains { $0.contains("SendButton") } ? "yes" : "no")")
  print("search=\(byId["TokenizedSearchBar_TextView"].map { text($0, "AXValue") } ?? "")")
  print("searching=\(searching ? "yes" : "no")")
case "rows":
  for r in rows { print("\(r.kind)\t\(r.section)\t\(r.name)\t\(r.preview.prefix(60))") }
case "press":
  guard args.count > 4 else { exit(1) }
  let want = clean(args[4])
  if let r = rows.first(where: { $0.kind == args[2] && (args[3].isEmpty || $0.section == args[3]) && $0.name == want }) {
    // The list reports rows that are scrolled out of sight, and pressing one does nothing: bring it into view first.
    _ = AXUIElementPerformAction(r.el, "AXScrollToVisible" as CFString)
    usleep(350_000)
    print(AXUIElementPerformAction(r.el, "AXPress" as CFString) == .success ? "pressed" : "failed")
  } else { print("not found"); exit(2) }
case "click-composer":
  // Accessibility's own "focus" does not give the message box the keyboard; a real click on it does. Its position comes from the tree.
  guard let c = byId["ChatBar_ComposerTextView"], let at = pos(c), let sv = attr(c, "AXSize"), CFGetTypeID(sv) == AXValueGetTypeID() else { print("no message box"); exit(2) }
  var size = CGSize.zero; AXValueGetValue(sv as! AXValue, .cgSize, &size)
  let point = CGPoint(x: at.x + min(size.width / 2, 120), y: at.y + size.height / 2)
  for t in [CGEventType.leftMouseDown, .leftMouseUp] { CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap) }
  print("clicked")
case "focus-composer":
  guard let c = byId["ChatBar_ComposerTextView"] else { print("no message box"); exit(2) }
  print(AXUIElementSetAttributeValue(c, "AXFocused" as CFString, kCFBooleanTrue) == .success ? "focused" : "failed")
case "press-send":
  guard let id = byId.keys.first(where: { $0.contains("SendButton") }), let b = byId[id] else { print("no send button"); exit(2) }
  print(AXUIElementPerformAction(b, "AXPress" as CFString) == .success ? "pressed" : "failed")
case "clear-search":
  guard let b = byId["TokenizedSearchBar_DeleteButton"] else { print("nothing to clear"); exit(0) }
  print(AXUIElementPerformAction(b, "AXPress" as CFString) == .success ? "cleared" : "failed")
default:
  FileHandle.standardError.write("usage: wachat state|rows|press|focus-composer|press-send|clear-search\n".data(using: .utf8)!); exit(1)
}
