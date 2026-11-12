// End-of-speech detector. Feed it the microphone level (RMS, 0 to 1) about every 50 ms with the time since recording started.
// It answers 'stop' once you have finished talking, 'none' if nobody said anything, and null to keep recording.
// Loaded by the page as a plain script, and by the tests with require().
// Levels measured on this Mac: silent room 0.001 to 0.005, speech a few feet away 0.02 to 0.04, so the floor for "speech" is low.
function makeVad({ graceMs = 600, quietMs = 1300, noSpeechMs = 7000, maxMs = 30000, minLevel = 0.006 } = {}) {
  let floor = 0.002; // the room's background level, tracked as the quietest recent moment
  let voice = 0; // how loud you have been lately; "quiet" is judged against this, so a noisy room (a TV, chewing) cannot hold the recording open
  let loudMs = 0;
  let lastLoud = 0;
  let prev = 0;
  return (rms, t) => {
    const dt = t - prev;
    prev = t;
    floor = Math.min(rms, floor * 1.003 + 0.0001);
    voice = Math.max(voice * 0.995, rms > Math.max(minLevel, floor * 3) ? rms : 0);
    const spoke = loudMs >= 250; // a click or a cough is shorter than that
    const bar = Math.max(minLevel, floor * 3, spoke ? voice * 0.25 : 0);
    if (t >= graceMs && rms > bar) { loudMs += dt; lastLoud = t; } // the start cue sound is ignored during the grace time
    if (loudMs >= 250 && t - lastLoud >= quietMs) return 'stop';
    if (loudMs < 250 && t >= noSpeechMs) return 'none';
    if (t >= maxMs) return loudMs >= 250 ? 'stop' : 'none';
    return null;
  };
}
if (typeof module !== 'undefined') module.exports = { makeVad };
