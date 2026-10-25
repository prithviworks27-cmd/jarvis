// Offline Kokoro voice. Runs as its own process so the ~300 MB model stays out of the Electron main process.
// Protocol: one JSON per line in ({id, text, voice}), one JSON per line out ({ready} | {id, file} | {id, error}).
import { KokoroTTS } from 'kokoro-js';
import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
// First run downloads ~90 MB (cached afterwards); progress/log noise must not reach stdout.
console.log = console.warn = (...a) => console.error(...a);

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
out({ ready: true });

for await (const line of readline.createInterface({ input: process.stdin })) {
  const { id, text, voice } = JSON.parse(line);
  try {
    const file = path.join(os.tmpdir(), `jarvis-kokoro-${process.pid}-${id}.wav`);
    await (await tts.generate(text, { voice })).save(file);
    out({ id, file });
  } catch (e) {
    out({ id, error: e.message });
  }
}
