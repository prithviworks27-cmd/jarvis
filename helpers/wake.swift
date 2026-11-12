// Listens for the assistant's name with macOS's own speech recognizer, entirely on this Mac (no network, no key), and prints
// "wake" when it hears it. Commands on stdin: "pause" stops listening (while JARVIS talks or records), "resume" starts again.
import Speech
import AVFoundation

setbuf(stdout, nil)
func fail(_ message: String, _ code: Int32) -> Never {
  print("error: " + message) // JARVIS reads stdout and shows this to you
  exit(code)
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-IN")), recognizer.supportsOnDeviceRecognition else {
  fail("On-device English speech recognition is not available on this Mac, so the Jarvis wake word is off.", 2)
}

// The name to listen for is the first argument (default "alfred"). Common mishearings of known names are accepted too.
let name = (CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "alfred").lowercased()
let spellings: [String: [String]] = [
  "alfred": ["alfred", "alfrid", "alfreid", "alfread", "alfrad", "al fred", "all fred", "alford", "albert", "elfred"],
  "jarvis": ["jarvis", "jarvas", "jarves", "jarvus", "jarvice", "jar vis", "charvis", "garvis"],
]
let heard = try! NSRegularExpression(pattern: "\\b(" + (spellings[name] ?? [name]).joined(separator: "|") + ")\\b")
let engine = AVAudioEngine()
var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?
var active = false
var lastWake = Date.distantPast
var lastText = ""
var lastBuffer = Date()
let queue = DispatchQueue(label: "wake")

func stopListening() {
  active = false
  engine.stop()
  engine.inputNode.removeTap(onBus: 0)
  request?.endAudio()
  task?.cancel()
  request = nil
  task = nil
}

// A new recognition task every so often, and after every wake: the transcript only grows, so an old "jarvis" would keep matching.
func startListening() {
  stopListening()
  let req = SFSpeechAudioBufferRecognitionRequest()
  req.requiresOnDeviceRecognition = true
  req.shouldReportPartialResults = true
  req.contextualStrings = [name.capitalized, "Hey " + name.capitalized] // tells the recognizer this word is expected: far more reliable, and quicker
  req.taskHint = .unspecified
  req.addsPunctuation = false
  request = req
  let input = engine.inputNode
  input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in lastBuffer = Date(); req.append(buffer) }
  do { try engine.start() } catch { fail("Could not open the microphone: \(error.localizedDescription)", 3) }
  active = true
  lastBuffer = Date() // the watchdog counts from now, not from before this restart
  task = recognizer.recognitionTask(with: req) { result, error in
    queue.async {
      guard active, request === req else { return }
      if let text = result?.bestTranscription.formattedString.lowercased() {
        if text != lastText { lastText = text; print("heard: " + text) } // JARVIS_WAKE_DEBUG=1 shows these
        let range = NSRange(text.startIndex..., in: text)
        if heard.firstMatch(in: text, range: range) != nil, Date().timeIntervalSince(lastWake) > 2 {
          lastWake = Date()
          print("wake")
          startListening()
          return
        }
      }
      if error != nil || result?.isFinal == true { startListening() }
    }
  }
  queue.asyncAfter(deadline: .now() + 45) { if active, request === req { startListening() } }
}

// If no audio arrives for a while (headphones connected, Mac woke from sleep, the input device changed) start over: otherwise it would stay deaf.
NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { _ in
  queue.async { if active { print("note: audio device changed, restarting"); startListening() } }
}
Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
  queue.async { if active, Date().timeIntervalSince(lastBuffer) > 5 { print("note: no audio for 5 s, restarting"); startListening() } }
}

SFSpeechRecognizer.requestAuthorization { status in
  guard status == .authorized else { fail("Speech Recognition permission is off. Turn it on in System Settings > Privacy & Security > Speech Recognition.", 4) }
  AVCaptureDevice.requestAccess(for: .audio) { ok in
    guard ok else { fail("Microphone permission is off.", 5) }
    queue.async { startListening() }
  }
}

// stdin is a pipe owned by JARVIS. When it closes (JARVIS quit or crashed) this helper must not keep the microphone open.
DispatchQueue.global().async {
  while let line = readLine() {
    queue.async {
      if line == "pause" { stopListening() } else if line == "resume", !active { startListening() } else if line == "quit" { exit(0) }
    }
  }
  exit(0)
}
RunLoop.main.run()
