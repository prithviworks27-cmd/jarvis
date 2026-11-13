// Prints the text of a PDF (first 40 pages, about 30,000 characters at most) using macOS's own PDFKit. Free, on-device.
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("Could not open that PDF.\n".data(using: .utf8)!)
  exit(1)
}
if doc.isLocked {
  FileHandle.standardError.write("That PDF is password protected.\n".data(using: .utf8)!)
  exit(1)
}
var out = ""
for i in 0..<min(doc.pageCount, 40) {
  if let text = doc.page(at: i)?.string { out += text + "\n" }
  if out.count > 30000 { break }
}
print(out)
