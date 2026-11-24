import fs from 'fs';
import path from 'path';

function getJpegDimensions(buffer: Buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    const length = buffer.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  return { width: 0, height: 0 };
}

for (let i = 1; i <= 4; i++) {
  const p = path.join(process.cwd(), 'scripts', 'fixtures', `receipt${i}.jpg`);
  const buf = fs.readFileSync(p);
  const dim = getJpegDimensions(buf);
  console.log(`receipt${i}.jpg: ${dim.width}x${dim.height}, size: ${buf.length} bytes`);
}
