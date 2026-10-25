// Groq-hosted Whisper. Takes a webm/opus Buffer, returns the transcript text.
async function transcribe(buf) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/webm' }), 'speech.webm');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'en');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Speech-to-text failed (${res.status}): ${await res.text()}`);
  return (await res.json()).text;
}

module.exports = { transcribe };
