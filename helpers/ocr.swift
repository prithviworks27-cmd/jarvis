// Reads the text in an image with macOS's built-in Vision framework (on-device, free): prints one line of text per row found.
import Vision
import AppKit

guard CommandLine.arguments.count > 1,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false // names are not dictionary words
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
for observation in request.results ?? [] {
  if let text = observation.topCandidates(1).first?.string { print(text) }
}
