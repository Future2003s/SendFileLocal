import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, 'uploads');

function tryFixMojibake(name) {
    try {
        const bytes = Buffer.from(name, 'latin1');
        const decoded = bytes.toString('utf8');
        if (Buffer.from(decoded, 'utf8').equals(bytes) && decoded !== name) return decoded;
        return name;
    } catch (_) { return name; }
}

const entries = fs.readdirSync(UPLOAD_DIR);
for (const name of entries) {
    const fixed = tryFixMojibake(name);
    if (fixed !== name) {
        const oldPath = path.join(UPLOAD_DIR, name);
        const newPath = path.join(UPLOAD_DIR, fixed);
        if (!fs.existsSync(newPath)) {
            fs.renameSync(oldPath, newPath);
            console.log(`Renamed: "${name}" -> "${fixed}"`);
        } else {
            console.log(`Skipped (exists): "${name}" -> "${fixed}"`);
        }
    }
}
console.log('\nFiles now:');
fs.readdirSync(UPLOAD_DIR).forEach(f => console.log(' ', f));
