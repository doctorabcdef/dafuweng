import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOARD, getPlayerAnimal } from './game.js';
import { createLandmark, LANDMARK_NAMES } from './landmarks.js';

const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .65, ...options });
const ivory = material('#fff8e8');
const navy = material('#18384a');
const gold = material('#edb842', { metalness: .7, roughness: .28 });
const darkGold = material('#af7526', { metalness: .6, roughness: .35 });
const rounded = (x, y, z, radius = .08) => new RoundedBoxGeometry(x, y, z, 2, radius);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function mesh(geometry, surface, parent, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, surface);
  object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true;
  parent.add(object); return object;
}
export function tilePoint(index) {
  const [row, col] = index <= 8 ? [8, 8 - index] : index <= 16 ? [16 - index, 0] : index <= 24 ? [0, index - 16] : [index - 24, 8];
  return new THREE.Vector3((col - 4) * 1.85, .39, (row - 4) * 1.85);
}
const faceNormals = { 1: [0, 1, 0], 6: [0, -1, 0], 2: [0, 0, 1], 5: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0] };
export function diceOrientation(value) {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...faceNormals[value]), new THREE.Vector3(0, 1, 0));
}
export function createDie() {
  const die = new THREE.Group();
  mesh(rounded(1.12, 1.12, 1.12, .12), ivory, die);
  const corners = [[-.25, -.25], [.25, -.25], [-.25, .25], [.25, .25]];
  for (let value = 1; value <= 6; value++) {
    const face = new THREE.Group(); face.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...faceNormals[value]));
    const points = value === 1 ? [[0, 0]] : value === 2 ? [corners[0], corners[3]] : value === 3 ? [corners[0], [0, 0], corners[3]] : value === 4 ? corners : value === 5 ? [...corners, [0, 0]] : [...corners, [-.25, 0], [.25, 0]];
    for (const [x, y] of points) {
      const pip = mesh(new THREE.SphereGeometry(.073, 12, 8), value === 1 ? material('#d96443') : navy, face, x, y, .555);
      pip.scale.z = .16; pip.castShadow = false;
    }
    face.userData.value = value; die.add(face);
  }
  return die;
}
function labelTexture(text, subtitle = '', color = '#18384a', background = null) {
  const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 384, 128); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.font = '700 43px "Microsoft YaHei", sans-serif'; ctx.fillText(text, 192, subtitle ? 43 : 64);
  if (subtitle) { ctx.font = '25px "Microsoft YaHei", sans-serif'; ctx.globalAlpha = .8; ctx.fillText(subtitle, 192, 96); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function flatLabel(parent, text, subtitle, width, height, x, y, z, color, background) {
  const label = mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: labelTexture(text, subtitle, color, background), transparent: true, depthWrite: false, side: THREE.DoubleSide }), parent, x, y, z);
  label.rotation.x = -Math.PI / 2; label.castShadow = false; return label;
}
function coin() {
  const group = new THREE.Group();
  mesh(new THREE.CylinderGeometry(.42, .42, .1, 32), darkGold, group);
  mesh(new THREE.CylinderGeometry(.37, .37, .112, 32), gold, group);
  const rim = mesh(new THREE.TorusGeometry(.372, .022, 5, 32), gold, group, 0, .059, 0); rim.rotation.x = -Math.PI / 2;
  // Embossed currency mark is geometry, so the coin keeps its thickness at every angle.
  const mark = new THREE.Group(); group.add(mark); mark.position.y = .067;
  mesh(new THREE.BoxGeometry(.032, .018, .25), darkGold, mark, 0, 0, .06);
  for (const z of [.035, .11]) mesh(new THREE.BoxGeometry(.22, .018, .028), darkGold, mark, 0, 0, z);
  for (const sign of [-1, 1]) { const arm = mesh(new THREE.BoxGeometry(.03, .018, .18), darkGold, mark, sign * .055, 0, -.10); arm.rotation.y = sign * -.63; }
  return group;
}
function animalFigure(animal, playerColor) {
  const group = new THREE.Group();
  const furColors = { cat: '#efae62', dog: '#b57d50', rabbit: '#fff0e4', fox: '#e27c37', panda: '#fffaf0', bear: '#966642', tiger: '#eeb244', lion: '#d8a553', koala: '#a4b3bb', frog: '#83b981', pig: '#efb2b3', monkey: '#976d4e', penguin: '#284557', chick: '#f5cf67', elephant: '#9eabb5', dolphin: '#74adb7' };
  const fur = material(furColors[animal.id] || '#dda65c');
  mesh(new THREE.CylinderGeometry(.32, .35, .1, 24), material(playerColor), group, 0, .07, 0);
  const body = mesh(new THREE.SphereGeometry(.23, 16, 12), fur, group, 0, .31, 0); body.scale.y = 1.15;
  mesh(new THREE.SphereGeometry(.25, 16, 12), fur, group, 0, .61, 0);
  for (const side of [-1, 1]) {
    const ears = ['cat', 'fox', 'tiger'].includes(animal.id);
    const ear = mesh(ears ? new THREE.ConeGeometry(.10, .24, 3) : new THREE.SphereGeometry(.10, 10, 8), animal.id === 'panda' ? navy : fur, group, side * .18, .81, 0);
    if (animal.id === 'rabbit') { ear.scale.set(.7, 2.2, .75); ear.position.y = .92; }
    if (animal.id === 'elephant') ear.scale.set(1.7, 1.4, .5);
    if (animal.id === 'dog') { ear.position.y = .65; ear.scale.y = 1.7; }
    mesh(new THREE.SphereGeometry(.037, 8, 6), navy, group, side * .09, .65, .225);
    mesh(new THREE.SphereGeometry(.065, 10, 8), fur, group, side * .12, .16, .17);
  }
  mesh(new THREE.SphereGeometry(.055, 10, 8), animal.id === 'pig' ? material('#d98799') : navy, group, 0, .56, .239);
  if (animal.id === 'elephant') mesh(new THREE.CylinderGeometry(.05, .04, .23, 8), fur, group, 0, .47, .25);
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(animal.emoji), depthTest: true }));
  badge.scale.set(.8, .27, 1); badge.position.set(0, 1.17, 0); group.add(badge);
  return group;
}
function house(color, level = 0, mortgaged = false) {
  const group = new THREE.Group(); const paint = material(mortgaged ? '#a3aaa9' : color);
  mesh(rounded(.43, .32 + level * .07, .38, .025), ivory, group, 0, .17, 0);
  const roof = mesh(new THREE.ConeGeometry(.37, .24, 4), paint, group, 0, .45 + level * .035, 0); roof.rotation.y = Math.PI / 4; roof.scale.z = .9;
  mesh(new THREE.BoxGeometry(.08, .15, .02), paint, group, 0, .13, .2);
  for (const x of [-.13, .13]) mesh(new THREE.BoxGeometry(.075, .075, .02), gold, group, x, .25, .2);
  return group;
}

export function createWorld({ canvas, onSelect, onChance, onUnavailable }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' }); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 150);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.enablePan = true;
  controls.minDistance = 5; controls.maxDistance = 48; controls.minPolarAngle = .28; controls.maxPolarAngle = 1.12;
  controls.target.set(0, .1, 0); controls.autoRotate = false;
  scene.add(new THREE.HemisphereLight('#fff5df', '#a4bec2', 1.8));
  const light = new THREE.DirectionalLight('#fff3d8', 2.8); light.position.set(-9, 21, 12); light.castShadow = true;
  light.shadow.mapSize.set(innerWidth < 600 ? 1024 : 2048, innerWidth < 600 ? 1024 : 2048); Object.assign(light.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 60 });
  light.shadow.bias = -.0003; light.shadow.normalBias = .03; scene.add(light);
  const fill = new THREE.DirectionalLight('#bee8fa', 1.4); fill.position.set(12, 8, -8); scene.add(fill);
  mesh(rounded(17.5, .62, 17.5, .22), material('#c29c69'), scene, 0, -.28, 0);
  mesh(rounded(17.35, .25, 17.35, .15), material('#f5e8cb'), scene, 0, .02, 0);
  mesh(rounded(12.6, .13, 12.6, .2), material('#d5e4d9'), scene, 0, .16, 0);
  const tiles = [], houses = new Map(), figures = new Map(), particles = [];
  const interactive = [];
  const tileGeometry = rounded(1.74, .25, 1.74, .07);
  const specials = { start: ['出发', '+2,000'], chance: ['机遇', '抽取卡片'], tax: ['税务', '800'], jail: ['监狱', '稍作停留'], parking: ['假日', '休息一下'], goToJail: ['入狱', '前往监狱'] };
  for (const tile of BOARD) {
    const point = tilePoint(tile.id); const tileGroup = new THREE.Group(); tileGroup.position.copy(point); tileGroup.position.y = .18; scene.add(tileGroup);
    const surface = material(tile.type === 'chance' ? '#e6dcf0' : tile.type === 'start' ? '#d6e5d6' : '#fff7e7');
    const base = mesh(tileGeometry, surface, tileGroup, 0, .07, 0); base.userData.tileId = tile.id; interactive.push(base);
    if (tile.color) mesh(new THREE.BoxGeometry(1.60, .026, .09), material(tile.color), tileGroup, 0, .21, -.73);
    if (tile.type === 'property') {
      const model = createLandmark(tile); model.position.set(0, .22, -.19); model.scale.setScalar(.80);
      model.userData.tileId = tile.id; tileGroup.add(model); model.traverse(child => { if (child.isMesh) { child.userData.tileId = tile.id; interactive.push(child); } });
      flatLabel(tileGroup, tile.name, '¥' + tile.price.toLocaleString(), 1.42, .48, 0, .22, .55);
    } else {
      const [title, sub] = specials[tile.type];
      flatLabel(tileGroup, title, sub, 1.46, .53, 0, .22, .45);
      if (tile.type === 'chance') {
        const card = mesh(rounded(.6, .09, .83, .03), navy, tileGroup, 0, .3, -.28); card.rotation.y = -.16;
        flatLabel(card, '✦', '', .45, .45, 0, .055, 0, '#ecc96c');
      } else if (tile.type === 'tax') { for (let i = 0; i < 3; i++) { const item = coin(); item.scale.setScalar(.6); item.position.set(0, .28 + i * .07, -.25); tileGroup.add(item); } }
      else if (tile.type === 'jail' || tile.type === 'goToJail') {
        mesh(new THREE.BoxGeometry(.85, .08, .5), navy, tileGroup, 0, .79, -.25);
        for (let i = -2; i <= 2; i++) mesh(new THREE.CylinderGeometry(.025, .025, .52, 6), navy, tileGroup, i * .18, .52, -.06);
      } else if (tile.type === 'start') { const flag = mesh(new THREE.ConeGeometry(.3, .5, 3), gold, tileGroup, 0, .59, -.2); flag.rotation.z = -.5; }
      else { mesh(new THREE.CylinderGeometry(.035, .035, .55, 8), navy, tileGroup, 0, .5, -.22); mesh(new THREE.ConeGeometry(.43, .23, 8), material('#dd8968'), tileGroup, 0, .83, -.22); }
    }
    tiles.push({ group: tileGroup, surface, color: surface.color.clone() });
  }
  flatLabel(scene, '世界大富翁', 'WORLD TOUR  ·  YOUR NEXT ADVENTURE', 6.3, 2.1, 0, .25, -3.0, '#315651');
  // A recessed dice tray and two solid dice occupy the heart of the table.
  mesh(rounded(5.8, .22, 3.9, .25), material('#b29a70'), scene, -.4, .30, .6);
  mesh(rounded(5.45, .12, 3.55, .2), material('#47665d'), scene, -.4, .45, .6);
  const dice = [createDie(), createDie()];
  dice.forEach((die, i) => { die.position.set(-1.5 + i * 2.05, 1.08, .65); scene.add(die); });
  for (let stack = 0; stack < 3; stack++) for (let i = 0; i < 3 + stack * 2; i++) {
    const item = coin(); item.position.set(-3.85 + (stack % 2) * .85, .30 + i * .115, 2.65 + Math.floor(stack / 2) * .78); scene.add(item);
  }
  flatLabel(scene, '金币银行', '', 2.2, .65, -3.5, .26, 4.3, '#846629');
  const deck = new THREE.Group(); deck.position.set(4, .29, 2.5); scene.add(deck);
  for (let i = 0; i < 5; i++) { const card = mesh(rounded(1.34, .07, 1.95, .06), i === 4 ? navy : ivory, deck, 0, i * .083, 0); card.rotation.y = (i - 2) * .025; card.userData.chance = true; interactive.push(card); }
  flatLabel(deck, '✦', '机遇卡', 1.13, 1.25, 0, .385, 0, '#f7d983');
  flatLabel(scene, '未知的惊喜', '', 2.1, .6, 4, .26, 4.05, '#755b87');
  const selection = mesh(new THREE.TorusGeometry(.70, .035, 6, 40), gold, scene); selection.rotation.x = -Math.PI / 2; selection.visible = false;
  let rollStarted = null, wasRolling = false, values = [5, 3], settleAt = 0, settling = false, settleFrom = [];
  let latestState = null, disposed = false, frame = null, lastFrame = 0, needsDraw = true;
  function resetCamera() { const aspect = canvas.clientWidth / canvas.clientHeight; const scale = Math.max(1, 1.3 / aspect); camera.position.set(15.4 * scale, 19.25 * scale, 18.48 * scale); controls.target.set(2, .1, 2); controls.update(); needsDraw = true; }
  function focus(tileId) { const point = tilePoint(tileId); controls.target.copy(point).add(new THREE.Vector3(0, .65, 0)); camera.position.copy(controls.target).add(new THREE.Vector3(3.6, 4, 4.5)); controls.update(); needsDraw = true; }
  function resize() { const width = canvas.clientWidth, height = canvas.clientHeight; if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); needsDraw = true; }
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); resetCamera();
  controls.addEventListener('change', () => { needsDraw = true; });
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', event => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    down = null; const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(interactive, false)[0];
    if (hit?.object.userData.chance && latestState?.phase === 'chance') onChance?.();
    else if (hit?.object.userData.tileId !== undefined) onSelect(hit.object.userData.tileId);
  });
  function update(state, view = {}) {
    const now = performance.now(); latestState = state; needsDraw = true;
    tiles.forEach((tile, index) => { tile.surface.color.copy(tile.color); if (view.selectedTile === index) tile.surface.color.lerp(new THREE.Color('#f3cd77'), .45); });
    selection.visible = view.selectedTile !== null && view.selectedTile !== undefined;
    if (selection.visible) { selection.position.copy(tilePoint(view.selectedTile)); selection.position.y = .43; }
    for (const tile of BOARD.filter(tile => tile.type === 'property')) {
      const property = state?.properties[tile.id]; const owner = state?.players.find(player => player.id === property?.ownerId);
      const key = owner ? `${owner.id}:${property.level}:${property.mortgaged}` : '';
      const previous = houses.get(tile.id);
      if (previous?.key !== key) {
        if (previous) { scene.remove(previous.object); disposeObject(previous.object); houses.delete(tile.id); }
        if (owner) { const object = house(owner.color, property.level, property.mortgaged); object.position.copy(tilePoint(tile.id)).add(new THREE.Vector3(.48, .03, .37)); scene.add(object); houses.set(tile.id, { key, object }); }
      }
      if (view.freshHouse === tile.id && houses.has(tile.id)) houses.get(tile.id).object.scale.setScalar(1.12);
      else if (houses.has(tile.id)) houses.get(tile.id).object.scale.setScalar(1);
    }
    const alive = new Set();
    for (const [index, player] of (state?.players || []).entries()) {
      if (player.bankrupt) continue; alive.add(player.id);
      const animal = getPlayerAnimal(player, index); let figure = figures.get(player.id);
      const position = view.presentation?.playerId === player.id ? view.presentation.position : player.position;
      const target = tilePoint(position).add(new THREE.Vector3(-.48 + (index % 2) * .34, .03, .45 - Math.floor(index / 2) * .35));
      if (!figure || figure.animal !== animal.id) {
        if (figure) { scene.remove(figure.object); disposeObject(figure.object); }
        const object = animalFigure(animal, player.color); object.position.copy(target); scene.add(object);
        figure = { object, animal: animal.id, target: target.clone(), from: target.clone(), at: 0, moving: false }; figures.set(player.id, figure);
      }
      if (!figure.target.equals(target)) {
        figure.from.copy(figure.object.position); figure.target.copy(target); figure.at = now;
        figure.moving = view.presentation?.stage === 'walking' && !reducedMotion();
        if (!figure.moving) figure.object.position.copy(target);
      }
    }
    for (const [id, figure] of figures) if (!alive.has(id)) { scene.remove(figure.object); disposeObject(figure.object); figures.delete(id); }
    const rolling = view.presentation?.stage === 'rolling' && !reducedMotion();
    if (rolling && !wasRolling) rollStarted = now;
    if (!rolling && wasRolling) { settleAt = now; settling = !reducedMotion(); settleFrom = dice.map(die => die.quaternion.clone()); }
    wasRolling = rolling; values = view.presentation?.dice || state?.dice || [5, 3];
    if (!rolling && !settling) dice.forEach((die, i) => { die.quaternion.copy(diceOrientation(values[i])); die.position.y = 1.08; });
    canvas.dataset.dice = values.join(','); canvas.dataset.rolling = String(rolling);
    canvas.dataset.landmarks = String(BOARD.filter(tile => tile.type === 'property').length);
    canvas.dataset.houses = String(houses.size); canvas.dataset.phase = state?.phase || 'setup';
    canvas.setAttribute('aria-label', `3D世界棋盘，20座国家地标。骰子 ${values.join(' 和 ')}。${state?.lastEvent || '拖动旋转，缩放查看地标。'}`);
  }
  function celebrate() {
    if (reducedMotion()) return;
    for (let i = 0; i < 9; i++) { const object = coin(); const angle = i / 9 * Math.PI * 2; object.position.set(-.5, 1.4, .7); scene.add(object); particles.push({ object, at: performance.now(), velocity: new THREE.Vector3(Math.cos(angle) * 2, 3 + i % 3 * .5, Math.sin(angle) * 2) }); }
    needsDraw = true;
  }
  function draw(now) {
    if (disposed) return; frame = requestAnimationFrame(draw);
    if (document.hidden || now - lastFrame < 30) return; lastFrame = now;
    controls.update(); let animated = false;
    if (wasRolling) {
      const elapsed = (now - rollStarted) / 1000;
      dice.forEach((die, i) => { die.rotation.set(elapsed * (10 + i), elapsed * (7 - i), elapsed * 8); die.position.y = 1.08 + Math.abs(Math.sin(elapsed * 11 + i)) * .9; }); animated = true;
    } else if (settling) {
      const t = Math.min(1, (now - settleAt) / 150);
      dice.forEach((die, i) => { die.quaternion.slerpQuaternions(settleFrom[i], diceOrientation(values[i]), 1 - (1 - t) ** 3); die.position.y += (1.08 - die.position.y) * t; });
      settling = t < 1; animated = true;
    }
    for (const figure of figures.values()) if (figure.moving) {
      const t = Math.min(1, (now - figure.at) / 145); figure.object.position.lerpVectors(figure.from, figure.target, t); figure.object.position.y += Math.sin(t * Math.PI) * .25;
      figure.moving = t < 1; animated = true;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const item = particles[i], t = (now - item.at) / 1000;
      if (t >= 1.2) { scene.remove(item.object); disposeObject(item.object); particles.splice(i, 1); continue; }
      item.object.position.set(-.5 + item.velocity.x * t, 1.4 + item.velocity.y * t - 3.8 * t * t, .7 + item.velocity.z * t); item.object.rotation.set(t * 6, t * 4, t * 3); animated = true;
    }
    if (needsDraw || animated) {
      try { renderer.render(scene, camera); needsDraw = false; canvas.dataset.rendered = 'true'; canvas.dataset.viewport = `${canvas.clientWidth}x${canvas.clientHeight}`; }
      catch { dispose(); onUnavailable?.(); }
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
    const geometries = new Set(), materials = new Set();
    scene.traverse(child => { if (child.geometry) geometries.add(child.geometry); if (child.material) materials.add(child.material); });
    for (const geometry of geometries) geometry.dispose();
    for (const surface of materials) { surface.map?.dispose(); surface.dispose(); }
    renderer.dispose();
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); dispose(); onUnavailable?.(); });
  frame = requestAnimationFrame(draw);
  document.body.classList.add('has-webgl'); update(null);
  return { update, celebrate, resetCamera, focus, dispose, landmarks: LANDMARK_NAMES };
}
function disposeObject(object) {
  // Shared coin and palette materials are deliberately retained for the scene lifetime.
  object.traverse(child => { child.geometry?.dispose(); if (child.material?.map) { child.material.map.dispose(); child.material.dispose(); } });
}
