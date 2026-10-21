/** Mono float PCM as a 16-bit WAV file. */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Buffer {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  let offset = 44;
  for (const chunk of chunks) {
    for (const s of chunk) {
      buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 0x7fff), offset);
      offset += 2;
    }
  }
  return buffer;
}
