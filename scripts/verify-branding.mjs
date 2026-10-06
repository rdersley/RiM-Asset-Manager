// Retail inMotion edition checks. This repository is the internal app for the Retail inMotion
// sandbox and work site; the Marketplace app lives in its own repository.
// Fails if any tracked file mentions the Marketplace brand. With --deploy, also fails while
// manifest.yml still carries the placeholder Forge app id (or the Marketplace app's id).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const MARKETPLACE_BRAND = /n[u]vriqo/i;
const MARKETPLACE_APP_ID = 'ffd70422-97fd-49bb-83ed-0dc607590642';

const failures = [];
const root = new URL('../', import.meta.url);
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
for (const file of files) {
  if (!fs.existsSync(new URL(file, root))) continue;
  const lines = fs.readFileSync(new URL(file, root), 'utf8').split('\n');
  lines.forEach((line, index) => { if (MARKETPLACE_BRAND.test(line)) failures.push(`${file}:${index + 1} mentions the Marketplace brand`); });
}

if (process.argv.includes('--deploy')) {
  const manifest = fs.readFileSync(new URL('manifest.yml', root), 'utf8');
  const id = manifest.match(/^\s+id:\s*(ari:cloud:ecosystem::app\/\S+)/m)?.[1] || '';
  if (!/^ari:cloud:ecosystem::app\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) failures.push('manifest.yml app.id is not set: run forge register "Retail inMotion Asset Manager" and commit the id it prints.');
  if (id.endsWith(MARKETPLACE_APP_ID)) failures.push('manifest.yml app.id is the Marketplace app; Retail inMotion needs its own Forge app.');
}

if (failures.length) {
  console.error('Retail inMotion verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Retail inMotion verification passed.');
