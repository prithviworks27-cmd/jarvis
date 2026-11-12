// End-of-speech detector. Feed it the microphone level (RMS, 0 to 1) about every 50 ms with the time since recording started.
// It answers 'stop' once you have finished talking, 'none' if nobody said anything, and null to keep recording.
// Loaded by the page as a plain script, and by the tests with require().
function makeVad({ graceMs = 600, quietMs = 1300, noSpeechMs = 7000, maxMs = 30000, minLevel = 0.02 } = {}) {
  let floor = 0.01; // the room's background level, tracked as the quietest recent moment
  let loudMs = 0;
  let lastLoud = 0;
  let prev = 0;
  return (rms, t) => {
    const dt = t - prev;
    prev = t;
    floor = Math.min(rms, floor * 1.003 + 0.0001);
    if (t >= graceMs && rms > Math.max(minLevel, floor * 3)) { loudMs += dt; lastLoud = t; } // the start cue sound is ignored during the grace time
    const spoke = loudMs >= 250; // a click or a cough is shorter than that
    if (spoke && t - lastLoud >= quietMs) return 'stop';
    if (!spoke && t >= noSpeechMs) return 'none';
    if (t >= maxMs) return spoke ? 'stop' : 'none';
    return null;
  };
}
if (typeof module !== 'undefined') module.exports = { makeVad };
