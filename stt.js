const PRIMER = 'Hinglish: Hindi and English mixed, written in Roman letters. Rishabh ka WhatsApp chat kholo. Mujhe aaj ka mausam batao. Chrome kholo. JARVIS.';

// Groq-hosted Whisper. Takes a webm/opus Buffer, returns the transcript text.
async function transcribe(buf) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/webm' }), 'speech.webm');
  form.append('model', 'whisper-large-v3-turbo');
  // No forced language: Whisper hears English, Hindi and Hinglish. The Roman-script primer makes Hindi come back as Hinglish
  // ("Rishabh ka WhatsApp chat kholo") instead of Devanagari, so names can still be matched. JARVIS_VOCAB adds your own names.
  if (process.env.JARVIS_STT_LANGUAGE) form.append('language', process.env.JARVIS_STT_LANGUAGE);
  form.append('prompt', `${PRIMER} ${process.env.JARVIS_VOCAB || ''}`.trim());
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Speech-to-text failed (${res.status}): ${await res.text()}`);
  return (await res.json()).text;
}

module.exports = { transcribe };
