import { mkdir, cp, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all(['index.html', 'src'].map(path => cp(path, 'dist/' + path, { recursive: true })));
await mkdir('dist/vendor/addons', { recursive: true });
await cp('node_modules/three/LICENSE', 'dist/vendor/LICENSE.txt');
await Promise.all(['three.module.js', 'three.core.js'].map(file => cp('node_modules/three/build/' + file, 'dist/vendor/' + file)));
await Promise.all(['controls/OrbitControls.js', 'geometries/RoundedBoxGeometry.js', 'utils/BufferGeometryUtils.js'].map(async file => {
  await mkdir('dist/vendor/addons/' + file.split('/')[0], { recursive: true });
  await cp('node_modules/three/examples/jsm/' + file, 'dist/vendor/addons/' + file);
}));
const config = { supabaseUrl: process.env.SUPABASE_URL || '', supabaseKey: process.env.SUPABASE_ANON_KEY || '' };
if (config.supabaseKey.startsWith('sb_secret_')) throw new Error('Use a public publishable/anon key, never a secret key.');
if (config.supabaseKey.split('.').length === 3) {
  const payload = JSON.parse(Buffer.from(config.supabaseKey.split('.')[1], 'base64url').toString());
  if (payload.role !== 'anon') throw new Error('Only the public anon JWT may be included in the website.');
}
await writeFile('dist/config.js', 'window.DAFUWENG_CONFIG = ' + JSON.stringify(config) + ';\n');
await writeFile('dist/.nojekyll', '');
console.log('Built static website in dist/; cloud: ' + Boolean(config.supabaseUrl && config.supabaseKey));
