import { mkdir, cp, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all(['index.html', 'src'].map(path => cp(path, 'dist/' + path, { recursive: true })));
const config = { supabaseUrl: process.env.SUPABASE_URL || '', supabaseKey: process.env.SUPABASE_ANON_KEY || '' };
if (config.supabaseKey.startsWith('sb_secret_')) throw new Error('Use a public publishable/anon key, never a secret key.');
if (config.supabaseKey.split('.').length === 3) {
  const payload = JSON.parse(Buffer.from(config.supabaseKey.split('.')[1], 'base64url').toString());
  if (payload.role !== 'anon') throw new Error('Only the public anon JWT may be included in the website.');
}
await writeFile('dist/config.js', 'window.DAFUWENG_CONFIG = ' + JSON.stringify(config) + ';\n');
await writeFile('dist/.nojekyll', '');
console.log('Built static website in dist/; cloud: ' + Boolean(config.supabaseUrl && config.supabaseKey));
