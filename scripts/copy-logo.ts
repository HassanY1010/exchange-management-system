import fs from 'fs';
import path from 'path';

const src = 'C:/Users/HP/.gemini/antigravity/brain/a3336cd6-8309-4c47-b12b-83c78d3c2851/.user_uploaded/media_1795421086208_282ab311.jpg';
const destDir = path.join(process.cwd(), 'public', 'brand');
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

const destLogo = path.join(destDir, 'logo.png');
fs.copyFileSync(src, destLogo);
console.log('Copied logo to:', destLogo, 'Size:', fs.statSync(destLogo).size);
