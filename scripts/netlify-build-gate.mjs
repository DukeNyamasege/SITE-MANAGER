import fs from 'node:fs';

const file = new URL('../netlify.deploy.json', import.meta.url);
let enabled = false;

try {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  enabled = config?.enabled === true;
} catch (error) {
  console.error('Unable to read netlify.deploy.json; defaulting to deployment hold.', error);
}

if (enabled) {
  console.log('Netlify deployment enabled. Continuing build.');
  process.exit(1);
}

console.log('Netlify deployment hold is active. Skipping build.');
process.exit(0);
