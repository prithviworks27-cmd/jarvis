// What the Mac's audio is doing right now, from CoreAudio (no microphone access needed, nothing is recorded):
//   output=speakers|headphones|bluetooth|usb|airplay|hdmi|other     where sound comes out
//   leaks=yes|no                                                    yes when that output is heard by the microphone (built-in speakers or HDMI)
//   input=<bundle id>,...                                           apps recording from a microphone right now
//   playing=<bundle id>,...                                         apps playing sound right now
// Needs macOS 14.2 or later for the per-app lists; older versions print empty lists.
import CoreAudio
import Foundation

func fourCC(_ v: UInt32) -> String { String(String(UnicodeScalar((v >> 24) & 255)!) + String(UnicodeScalar((v >> 16) & 255)!) + String(UnicodeScalar((v >> 8) & 255)!) + String(UnicodeScalar(v & 255)!)) }
func addr(_ s: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress { AudioObjectPropertyAddress(mSelector: s, mScope: scope, mElement: kAudioObjectPropertyElementMain) }
func get<T>(_ obj: AudioObjectID, _ a: AudioObjectPropertyAddress, _ zero: T) -> T? {
  var a = a; var v = zero; var size = UInt32(MemoryLayout<T>.size)
  return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : nil
}

// Where the sound goes.
var output = "other", leaks = false
if let dev = get(AudioObjectID(kAudioObjectSystemObject), addr(kAudioHardwarePropertyDefaultOutputDevice), AudioDeviceID(0)), dev != 0, let transport = get(dev, addr(kAudioDevicePropertyTransportType), UInt32(0)) {
  switch fourCC(transport) {
  case "bltn":
    // Built in: the speakers, unless something is plugged into the headphone jack.
    let src = get(dev, addr(kAudioDevicePropertyDataSource, kAudioObjectPropertyScopeOutput), UInt32(0)).map(fourCC) ?? ""
    if src == "hdpn" { output = "headphones" } else { output = "speakers"; leaks = true }
  case "blue", "blea": output = "bluetooth"
  case "usb ": output = "usb"
  case "airp": output = "airplay"
  case "hdmi", "dprt": output = "hdmi"; leaks = true
  default: output = "other"
  }
}

// Which apps are using the microphone / playing sound.
var input: [String] = [], playing: [String] = []
var list = addr(kAudioHardwarePropertyProcessObjectList)
var size: UInt32 = 0
if AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &list, 0, nil, &size) == noErr, size > 0 {
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &list, 0, nil, &size, &ids) == noErr {
    for id in ids {
      var bundle: CFString = "" as CFString
      var bsize = UInt32(MemoryLayout<CFString>.size)
      var ba = addr(kAudioProcessPropertyBundleID)
      let name = AudioObjectGetPropertyData(id, &ba, 0, nil, &bsize, &bundle) == noErr ? (bundle as String) : ""
      let pid = get(id, addr(kAudioProcessPropertyPID), Int32(0)) ?? 0
      let label = name.isEmpty ? "pid:\(pid)" : name
      if (get(id, addr(kAudioProcessPropertyIsRunningInput), UInt32(0)) ?? 0) != 0 { input.append(label) }
      if (get(id, addr(kAudioProcessPropertyIsRunningOutput), UInt32(0)) ?? 0) != 0 { playing.append(label) }
    }
  }
}
print("output=\(output)")
print("leaks=\(leaks ? "yes" : "no")")
print("input=\(input.joined(separator: ","))")
print("playing=\(playing.joined(separator: ","))")
