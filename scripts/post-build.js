import { copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

// Files to copy to dist root
const filesToCopy = [
  'sw.js',
  'icon-192.svg',
  'icon-512.svg',
  'manifest.json'
];

console.log('Copying static files to dist/...');

filesToCopy.forEach(file => {
  try {
    const src = join(root, 'public', file);
    const dest = join(root, 'dist', file);
    copyFileSync(src, dest);
    console.log(`✓ Copied ${file}`);
  } catch (err) {
    console.warn(`⚠ Could not copy ${file}:`, err.message);
  }
});

console.log('Post-build complete!');
