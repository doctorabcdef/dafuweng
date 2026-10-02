import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LANDMARK_NAMES = Object.freeze({
  1: '中国长城', 3: '日本鸟居', 5: '首尔塔', 6: '滨海湾金沙',
  8: '泰国金顶寺庙', 9: '泰姬陵', 11: '埃菲尔铁塔', 12: '勃兰登堡门',
  14: '罗马斗兽场', 15: '圣家堂', 16: '大本钟', 18: '阿尔卑斯山与钟楼',
  20: '自由女神像', 21: '加拿大国家电视塔', 23: '里约基督像', 24: '布宜诺斯艾利斯方尖碑',
  26: '悉尼歌剧院', 27: '奥克兰天空塔', 29: '吉萨金字塔', 31: '桌山',
});

const COLORS = Object.freeze({
  stone: '#ddcfaa', cream: '#fff0cf', white: '#f9f5e8', shadow: '#544f57',
  glass: '#6eafb5', darkGlass: '#274c61', gold: '#eeb951', green: '#749767',
  water: '#7bc9cd', bronze: '#806c53', terracotta: '#c97850', teal: '#64ae98',
});
const UP = new THREE.Vector3(0, 1, 0);
const HALF_PI = Math.PI / 2;

// Components are baked into a vertex-coloured geometry, so even an intricate
// building takes one draw call. No textures, fonts or external models.
class Sculpture {
  constructor() { this.parts = new Map(); }

  add(geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    geometry.scale(...scale);
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);
    geometry.translate(...position);
    const baked = geometry.index ? geometry.toNonIndexed() : geometry;
    if (baked !== geometry) geometry.dispose();
    // Primitives and hand-built geometry must have matching attributes to merge.
    for (const name of Object.keys(baked.attributes)) if (name !== 'position' && name !== 'normal') baked.deleteAttribute(name);
    if (!baked.getAttribute('normal')) baked.computeVertexNormals();
    baked.clearGroups();
    if (!this.parts.has(color)) this.parts.set(color, []);
    this.parts.get(color).push(baked);
    return this;
  }

  box(x, y, z, width, height, depth, color, rotation = [0, 0, 0]) {
    return this.add(new THREE.BoxGeometry(width, height, depth), color, [x, y, z], rotation);
  }

  cylinder(x, y, z, bottom, top, height, color, sides = 10, rotation = [0, 0, 0]) {
    return this.add(new THREE.CylinderGeometry(top, bottom, height, sides), color, [x, y, z], rotation);
  }

  cone(x, y, z, radius, height, color, sides = 4, rotationY = Math.PI / 4) {
    return this.cylinder(x, y, z, radius, 0, height, color, sides, [0, rotationY, 0]);
  }

  ball(x, y, z, radius, color, scale = [1, 1, 1], detail = 1) {
    return this.add(new THREE.IcosahedronGeometry(radius, detail), color, [x, y, z], [0, 0, 0], scale);
  }

  ring(x, y, z, radius, tube, color, rotation = [HALF_PI, 0, 0], arc = Math.PI * 2) {
    return this.add(new THREE.TorusGeometry(radius, tube, 5, 20, arc), color, [x, y, z], rotation);
  }

  beam(start, end, width, color, depth = width) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const direction = b.clone().sub(a);
    const geometry = new THREE.BoxGeometry(width, direction.length(), depth);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()));
    return this.add(geometry, color, a.add(b).multiplyScalar(.5).toArray());
  }

  rod(start, end, radius, color, endRadius = radius, sides = 7) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(endRadius, radius, direction.length(), sides);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()));
    return this.add(geometry, color, a.add(b).multiplyScalar(.5).toArray());
  }

  prism(points, depth, color, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
    geometry.translate(0, 0, -depth / 2);
    return this.add(geometry, color, position, rotation);
  }

  plinth(color = COLORS.stone, width = 1, depth = width, height = .07) {
    this.box(0, height / 2, 0, width, height, depth, color);
  }

  tree(x, z, height = .28, color = COLORS.green, base = .07) {
    this.cylinder(x, base + height * .26, z, .018, .014, height * .5, COLORS.bronze, 6);
    this.ball(x, base + height * .7, z, height * .33, color, [.85, 1.1, .85], 0);
  }

  finish(id) {
    const group = new THREE.Group();
    group.name = LANDMARK_NAMES[id] || '未设置地标';
    group.userData = { kind: 'landmark', tileId: id, landmarkName: group.name };
    const components = [];
    for (const [color, pieces] of this.parts) {
      const pigment = new THREE.Color(color);
      for (const piece of pieces) {
        const colors = new Float32Array(piece.getAttribute('position').count * 3);
        for (let i = 0; i < colors.length; i += 3) {
          colors[i] = pigment.r; colors[i + 1] = pigment.g; colors[i + 2] = pigment.b;
        }
        piece.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        components.push(piece);
      }
    }
    if (!components.length) return group;
    const geometry = mergeGeometries(components, false);
    components.forEach(piece => piece.dispose());
    if (!geometry) throw new Error(`无法合并地标 ${id} 的几何体`);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .76, metalness: .04, flatShading: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${group.name} · 彩色模型`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const scale = Math.min(1, 1.04 / size.x, 1.04 / size.z, 1.78 / size.y);
    for (const mesh of group.children) {
      mesh.geometry.translate(-center.x, -bounds.min.y, -center.z);
      mesh.geometry.scale(scale, scale, scale);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
    group.userData.bounds = { width: size.x * scale, height: size.y * scale, depth: size.z * scale };
    group.userData.drawCalls = group.children.length;
    group.userData.palette = [...this.parts.keys()];
    return group;
  }
}

function clockFace(s, x, y, z, radius, yaw = 0) {
  s.add(new THREE.CircleGeometry(radius, 16), COLORS.cream, [x, y, z], [0, yaw, 0]);
  s.ring(x, y, z, radius, radius * .09, COLORS.gold, [0, yaw, 0]);
  const point = (u, v, out = .005) => [x + Math.cos(yaw) * u + Math.sin(yaw) * out, y + v, z - Math.sin(yaw) * u + Math.cos(yaw) * out];
  s.beam(point(0, 0), point(0, radius * .7), radius * .075, COLORS.shadow);
  s.beam(point(0, 0), point(radius * .47, -.13 * radius), radius * .075, COLORS.shadow);
  for (let i = 0; i < 4; i++) {
    const a = i * HALF_PI;
    s.beam(point(Math.sin(a) * radius * .79, Math.cos(a) * radius * .79), point(Math.sin(a) * radius * .9, Math.cos(a) * radius * .9), radius * .065, COLORS.shadow);
  }
}

function greatWall(s) {
  s.plinth('#91a67d', 1.03, .74);
  const stones = '#a5a08a', cap = '#d6c3a0';
  const points = [[-.4, -.17], [-.2, -.08], [0, .11], [.2, .12], [.4, -.02]];
  for (let i = 0; i < points.length - 1; i++) {
    const [x, z] = points[i], [nx, nz] = points[i + 1];
    const length = Math.hypot(nx - x, nz - z), yaw = -Math.atan2(nz - z, nx - x);
    const midX = (x + nx) / 2, midZ = (z + nz) / 2;
    s.box(midX, .25 + i * .015, midZ, length + .035, .34, .16, stones, [0, yaw, 0]);
    s.box(midX, .43 + i * .015, midZ, length + .04, .035, .19, cap, [0, yaw, 0]);
    for (let j = 0; j < 4; j++) {
      const t = j / 3;
      for (const side of [-1, 1]) s.box(x + (nx - x) * t + Math.sin(yaw) * side * .084, .475 + i * .015, z + (nz - z) * t + Math.cos(yaw) * side * .084, .048, .07, .04, cap, [0, yaw, 0]);
    }
  }
  for (const [x, z, h] of [[-.4, -.17, .65], [.38, 0, .75], [0, .11, .56]]) {
    s.box(x, h / 2 + .06, z, .22, h, .22, stones);
    s.box(x, h + .055, z, .27, .055, .27, cap);
    for (const xx of [-1, 1]) for (const zz of [-1, 1]) s.box(x + xx * .1, h + .12, z + zz * .1, .067, .09, .067, cap);
    s.box(x, h - .055, z + .111, .045, .09, .006, '#525750');
  }
  s.tree(-.3, .27, .2); s.tree(.25, -.25, .22, '#617e5b');
}

function torii(s) {
  s.plinth('#c8c8b3', .98, .68);
  const red = '#d9533d', black = '#384749';
  for (const side of [-1, 1]) {
    s.cylinder(side * .3, .55, 0, .055, .046, .94, red, 10);
    s.cylinder(side * .3, .16, 0, .074, .065, .19, black, 8);
    s.box(side * .3, .075, 0, .17, .045, .17, '#8b9790');
  }
  s.box(0, .91, 0, .82, .075, .095, red);
  s.box(0, 1.14, 0, .9, .11, .16, red);
  s.box(0, 1.215, 0, .98, .055, .18, black);
  for (const side of [-1, 1]) s.box(side * .46, 1.24, 0, .16, .055, .18, black, [0, 0, side * .17]);
  s.box(0, 1.015, 0, .043, .16, .085, red);
  s.box(0, 1.055, .056, .085, .125, .018, COLORS.gold);
  for (let i = 0; i < 3; i++) s.box(0, .081, .16 + i * .064, .22, .016, .045, '#ece5d1');
  for (const side of [-1, 1]) {
    s.cylinder(side * .41, .19, .2, .025, .025, .23, '#9ba293', 6);
    s.box(side * .41, .32, .2, .1, .09, .09, COLORS.cream);
    s.cone(side * .41, .4, .2, .09, .07, black);
  }
}

function seoulTower(s) {
  s.plinth('#8ca184', .78, .7);
  s.cylinder(0, .13, 0, .24, .2, .15, COLORS.stone, 10);
  s.cylinder(0, .59, 0, .061, .043, .85, COLORS.white, 10);
  s.cylinder(0, 1.03, 0, .115, .21, .12, COLORS.white, 12);
  s.cylinder(0, 1.12, 0, .21, .21, .11, COLORS.darkGlass, 12);
  s.cylinder(0, 1.195, 0, .23, .18, .04, COLORS.white, 12);
  s.cylinder(0, 1.24, 0, .16, .13, .045, COLORS.glass, 12);
  s.cone(0, 1.3, 0, .13, .075, COLORS.white, 12, 0);
  s.cylinder(0, 1.47, 0, .026, .014, .31, '#bd5248', 7);
  s.cylinder(0, 1.65, 0, .009, .006, .13, COLORS.white, 6);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    s.box(Math.sin(a) * .202, 1.12, Math.cos(a) * .202, .012, .12, .018, COLORS.white, [0, a, 0]);
  }
  s.tree(-.24, .16, .27); s.tree(.22, -.17, .25, '#527c68');
}

function marinaBay(s) {
  s.plinth(COLORS.water, 1.03, .64);
  for (const x of [-.32, 0, .32]) {
    s.box(x, .56, 0, .2, .96, .23, '#e6d5b0');
    s.box(x, .59, .121, .138, .89, .012, '#6c9da4');
    s.box(x, .59, -.121, .138, .89, .012, '#6c9da4');
    for (let level = 0; level < 11; level++) s.box(x, .17 + level * .075, .132, .2, .012, .018, COLORS.cream);
    s.box(x - .075, .55, .137, .017, .95, .018, COLORS.cream);
  }
  s.prism([[-.53, .035], [-.44, -.075], [.34, -.075], [.54, .055], [.42, .075], [-.45, .075]], .3, '#ccb490', [0, 1.095, 0]);
  s.box(0, 1.18, 0, .88, .022, .21, COLORS.green);
  s.box(-.03, 1.2, .075, .63, .018, .055, '#76d4d9');
  for (const x of [-.34, -.1, .13, .33]) {
    s.cylinder(x, 1.225, -.072, .008, .008, .07, COLORS.bronze, 5);
    s.ball(x, 1.275, -.072, .035, '#558365', [1, .6, 1], 0);
  }
  s.box(0, .11, .21, .66, .07, .12, COLORS.stone);
}

function thaiTemple(s) {
  s.plinth('#d8c39b', .99, .84);
  s.box(0, .12, 0, .76, .09, .6, COLORS.white);
  s.box(0, .35, 0, .61, .4, .43, '#f5e3bd');
  s.box(0, .33, .225, .17, .32, .02, '#7f3f40');
  for (const x of [-.25, .25]) s.cylinder(x, .36, .24, .027, .027, .44, COLORS.gold, 7);
  for (let level = 0; level < 3; level++) {
    const width = .78 - level * .19, y = .65 + level * .155;
    s.prism([[-width / 2, 0], [0, .26 - level * .035], [width / 2, 0]], .51 - level * .12, '#b94f42', [0, y, 0]);
    s.beam([-width / 2, y, .267 - level * .06], [0, y + .26 - level * .035, .267 - level * .06], .025, COLORS.gold);
    s.beam([0, y + .26 - level * .035, .267 - level * .06], [width / 2, y, .267 - level * .06], .025, COLORS.gold);
    for (const side of [-1, 1]) s.rod([side * width / 2, y, .22 - level * .045], [side * (width / 2 + .035), y + .095, .22 - level * .045], .015, COLORS.gold, .002);
  }
  s.cone(0, 1.285, 0, .05, .28, COLORS.gold, 6, 0);
  for (const x of [-.4, .4]) {
    s.cylinder(x, .21, .28, .066, .045, .27, COLORS.cream, 6);
    s.cone(x, .41, .28, .07, .2, COLORS.gold, 6, 0);
  }
}

function tajMahal(s) {
  s.plinth('#eddcc4', 1.02, .97);
  s.box(0, .29, -.05, .6, .41, .5, COLORS.white);
  s.box(0, .115, .27, .2, .08, .24, '#8dc8c4');
  s.box(0, .29, .21, .17, .3, .015, '#ac9b86');
  s.ring(0, .43, .224, .083, .018, COLORS.cream, [0, 0, 0], Math.PI);
  s.cylinder(0, .53, -.05, .19, .19, .1, COLORS.cream, 14);
  s.ball(0, .685, -.05, .224, COLORS.white, [1, .97, 1], 1);
  s.cone(0, .875, -.05, .08, .19, COLORS.white, 10, 0);
  s.cylinder(0, 1.015, -.05, .012, .007, .16, COLORS.gold, 6);
  for (const x of [-.245, .245]) for (const z of [-.21, .12]) {
    s.cylinder(x, .565, z, .067, .067, .13, COLORS.cream, 8);
    s.ball(x, .659, z, .088, COLORS.white, [1, .8, 1], 0);
    s.cone(x, .738, z, .035, .09, COLORS.gold, 6, 0);
  }
  for (const x of [-.42, .42]) for (const z of [-.38, .38]) {
    s.cylinder(x, .425, z, .04, .03, .69, COLORS.white, 10);
    for (const y of [.29, .54, .76]) s.cylinder(x, y, z, .057, .057, .035, COLORS.cream, 10);
    s.cone(x, .84, z, .059, .14, COLORS.white, 8, 0);
  }
  for (const x of [-.22, .22]) s.box(x, .28, .213, .07, .14, .012, '#c9bba6');
}

function eiffelTower(s) {
  s.plinth('#c8bfa5', .94, .88);
  const iron = '#9b7550', trim = '#d6a96a';
  const levels = [{ y: .08, r: .37 }, { y: .59, r: .21 }, { y: 1.01, r: .12 }, { y: 1.43, r: .028 }];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let i = 0; i < levels.length - 1; i++) {
      const a = levels[i], b = levels[i + 1];
      s.beam([sx * a.r, a.y, sz * a.r], [sx * b.r, b.y, sz * b.r], .045 - i * .012, iron);
    }
    s.box(sx * .37, .09, sz * .37, .14, .06, .14, COLORS.stone);
  }
  for (const [y, size] of [[.57, .52], [.99, .31]]) s.box(0, y, 0, size, .045, size, trim);
  for (let side = 0; side < 4; side++) {
    const yaw = side * HALF_PI;
    const pt = (u, y, r) => [Math.cos(yaw) * u + Math.sin(yaw) * r, y, -Math.sin(yaw) * u + Math.cos(yaw) * r];
    for (let i = 0; i < 3; i++) {
      const a = levels[i], b = levels[i + 1];
      const midY = (a.y + b.y) / 2, midR = (a.r + b.r) / 2;
      s.beam(pt(-a.r, a.y + .035, a.r), pt(midR, midY, midR), .018, iron);
      s.beam(pt(a.r, a.y + .035, a.r), pt(-midR, midY, midR), .018, iron);
      s.beam(pt(-midR, midY, midR), pt(b.r, b.y, b.r), .014, iron);
      s.beam(pt(midR, midY, midR), pt(-b.r, b.y, b.r), .014, iron);
    }
  }
  s.cylinder(0, 1.515, 0, .018, .012, .2, iron, 6);
  s.cylinder(0, 1.665, 0, .006, .003, .13, trim, 5);
}

function brandenburgGate(s) {
  s.plinth('#c7bea9', 1.02, .65);
  s.box(0, .12, 0, .93, .06, .43, COLORS.stone);
  for (const z of [-.115, .115]) for (const x of [-.37, -.22, -.075, .075, .22, .37]) {
    s.cylinder(x, .405, z, .035, .03, .52, '#e6d7b6', 8);
    s.box(x, .16, z, .084, .045, .082, COLORS.cream);
    s.box(x, .665, z, .076, .047, .079, COLORS.cream);
  }
  s.box(0, .745, 0, .94, .11, .42, COLORS.stone);
  s.box(0, .822, 0, 1, .045, .45, COLORS.cream);
  for (let i = 0; i < 13; i++) s.box(-.425 + i * .071, .748, .218, .025, .066, .015, '#b7a789');
  s.box(0, .88, 0, .38, .075, .24, '#b8aa91');
  // A small green quadriga, with four horses and the victory standard.
  const patina = '#577f72';
  for (const x of [-.135, -.045, .045, .135]) {
    s.box(x, 1.004, .046, .063, .082, .17, patina);
    s.rod([x, 1.015, .09], [x, 1.12, .125], .019, patina);
    s.ball(x, 1.13, .137, .034, patina, [.7, .8, 1.1], 0);
    for (const z of [-.01, .104]) s.rod([x, .96, z], [x, .92, z + .014], .012, patina);
  }
  s.cylinder(0, 1.08, -.1, .035, .024, .23, patina, 6);
  s.ball(0, 1.22, -.1, .045, patina, [1, 1, 1], 0);
  s.rod([.08, 1.08, -.11], [.08, 1.35, -.11], .009, patina);
  s.ring(.08, 1.33, -.11, .045, .011, patina, [0, 0, 0]);
}

function ellipticalBand(s, inner, outer, y, height, color, start = 0, arc = Math.PI * 2) {
  const positions = [], indices = [], segments = Math.max(2, Math.ceil(arc / (Math.PI * 2) * 32));
  for (let i = 0; i <= segments; i++) {
    const a = start + arc * i / segments;
    for (const [r, h] of [[inner, y], [outer, y], [inner, y + height], [outer, y + height]]) positions.push(Math.sin(a) * r, h, Math.cos(a) * r * .75);
    if (i < segments) {
      const n = i * 4;
      for (const [a0, b, c, d] of [[0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) indices.push(n + a0, n + b, n + c, n + a0, n + c, n + d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); s.add(geometry, color);
}

function colosseum(s) {
  s.plinth('#d9ba8e', 1.02, .8);
  s.cylinder(0, .09, 0, .37, .37, .035, '#cfb386', 24, [0, 0, 0]);
  for (let floor = 0; floor < 3; floor++) {
    const y = .12 + floor * .19;
    ellipticalBand(s, .37, .49, y, .035, '#d8b98c');
    const count = floor === 2 ? 14 : 20;
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / 20;
      s.box(Math.sin(a) * .433, y + .095, Math.cos(a) * .433 * .75, .046, .16, .1, '#e7cba2', [0, a, 0]);
      // The curved arcade openings remain real gaps between piers.
      const next = a + Math.PI / 20;
      s.add(new THREE.TorusGeometry(.048, .018, 4, 8, Math.PI), '#e7cba2', [Math.sin(next) * .45, y + .12, Math.cos(next) * .45 * .75], [0, next, 0]);
    }
    ellipticalBand(s, .37, .49, y + .172, .035, '#b99670', 0, floor === 2 ? Math.PI * 1.42 : Math.PI * 2);
  }
  ellipticalBand(s, .32, .35, .1, .08, '#a98261');
}

function sagradaFamilia(s) {
  s.plinth('#c7b495', .97, .86);
  s.box(0, .28, 0, .65, .4, .53, '#d8b984');
  s.prism([[-.32, 0], [0, .33], [.32, 0]], .45, '#c59662', [0, .44, 0]);
  for (const [x, z, h] of [[-.27, .19, 1.14], [-.09, .23, 1.3], [.09, .23, 1.3], [.27, .19, 1.14], [-.2, -.18, 1.42], [.2, -.18, 1.42]]) {
    s.cylinder(x, h / 2 + .1, z, .069, .03, h - .15, '#d6b47e', 8);
    for (let j = 0; j < 6; j++) s.cylinder(x, .44 + j * (h - .48) / 6, z, .073 - j * .006, .071 - j * .006, .028, '#b28959', 8);
    s.ball(x, h + .075, z, .054, x < 0 ? '#d97950' : '#dcae42', [1, 1.25, 1], 0);
    s.cone(x, h + .17, z, .025, .12, COLORS.gold, 6, 0);
  }
  s.cylinder(0, 1.17, -.02, .08, .033, .67, '#ead1a1', 8);
  s.cone(0, 1.58, -.02, .063, .22, '#d6a866', 6, 0);
  s.box(0, 1.76, -.02, .019, .18, .019, COLORS.gold);
  s.box(0, 1.785, -.02, .12, .022, .019, COLORS.gold);
  s.box(0, .26, .273, .13, .29, .014, '#6e5a4b');
  s.ring(0, .495, .279, .063, .018, '#ebd4a6', [0, 0, 0]);
}

function bigBen(s) {
  s.plinth('#cdc4a8', .69, .7);
  s.box(0, .14, 0, .49, .15, .47, '#b89b68');
  s.box(0, .63, 0, .31, .9, .31, '#ddc58e');
  for (const x of [-.137, .137]) for (const z of [-.137, .137]) s.box(x, .685, z, .029, 1.05, .029, '#b2935b');
  for (const y of [.33, .52, .71, .9]) {
    s.box(0, y, 0, .34, .026, .34, '#a88c58');
    for (const x of [-.07, 0, .07]) s.box(x, y + .09, .16, .026, .11, .007, '#7a8278');
  }
  s.box(0, 1.125, 0, .37, .25, .37, '#c9b073');
  clockFace(s, 0, 1.13, .19, .101);
  clockFace(s, .19, 1.13, 0, .101, HALF_PI);
  clockFace(s, 0, 1.13, -.19, .101, Math.PI);
  clockFace(s, -.19, 1.13, 0, .101, -HALF_PI);
  s.box(0, 1.275, 0, .42, .046, .42, '#a58a57');
  s.cone(0, 1.445, 0, .282, .31, '#547c72');
  s.box(0, 1.535, 0, .13, .17, .13, '#c3a564');
  s.cone(0, 1.7, 0, .11, .23, '#547c72');
  s.cylinder(0, 1.87, 0, .012, .007, .13, COLORS.gold, 6);
  for (const x of [-.16, .16]) for (const z of [-.16, .16]) s.cone(x, 1.36, z, .026, .15, COLORS.gold, 4);
}

function swissAlps(s) {
  s.plinth('#84a180', 1.01, .86);
  const peaks = [[-.22, -.13, .38, .82], [.2, -.14, .3, 1.05], [.38, .04, .22, .66]];
  for (const [x, z, r, h] of peaks) {
    s.cone(x, .09 + h / 2, z, r, h, '#829294', 5, .18);
    s.cone(x, .09 + h * .84, z, r * .32, h * .32, '#f7faf3', 5, .18);
  }
  s.box(-.16, .285, .23, .25, .4, .23, '#eddec2');
  s.box(-.16, .16, .357, .052, .145, .014, '#946344');
  s.cone(-.16, .57, .23, .206, .25, '#b76149', 4);
  clockFace(s, -.16, .382, .35, .071);
  s.cylinder(-.16, .734, .23, .012, .01, .08, COLORS.gold, 6);
  for (const [x, z] of [[-.38, .21], [.19, .28], [.35, .25]]) {
    s.cylinder(x, .155, z, .013, .013, .15, COLORS.bronze, 5);
    s.cone(x, .3, z, .09, .31, '#496e58', 6, 0);
  }
  s.box(.065, .1, .31, .11, .016, .2, COLORS.stone, [0, .22, 0]);
}

function statueOfLiberty(s) {
  s.plinth('#bec8ad', .82, .75);
  s.box(0, .13, 0, .53, .13, .5, '#b6a27f');
  s.box(0, .255, 0, .36, .17, .34, '#d2b991');
  s.box(0, .36, 0, .43, .065, .41, '#e0c99f');
  const green = '#68b49e', shade = '#468975', light = '#97cbbb';
  s.cylinder(0, .665, 0, .17, .105, .56, green, 8);
  s.ball(0, .976, 0, .132, green, [1, 1.28, .85], 1);
  s.cylinder(0, 1.115, .015, .04, .04, .115, green, 7);
  s.ball(0, 1.22, .025, .095, green, [.82, 1.06, .9], 1);
  s.ball(0, 1.22, -.029, .09, shade, [.93, .95, .8], 0);
  // Seven outward crown rays silhouette clearly above the head.
  s.ring(0, 1.255, .024, .087, .018, light);
  for (let i = 0; i < 7; i++) {
    const a = .1 + i * (Math.PI - .2) / 6;
    s.rod([Math.cos(a) * .072, 1.253 + Math.sin(a) * .02, .025], [Math.cos(a) * .15, 1.258 + Math.sin(a) * .145, .025], .015, green, .001, 5);
  }
  s.box(-.028, 1.226, .107, .014, .01, .006, shade);
  s.box(.028, 1.226, .107, .014, .01, .006, shade);
  // Raised right arm, a separate torch cup, and a warm faceted flame.
  s.rod([.088, 1.024, 0], [.235, 1.255, .008], .066, green, .044);
  s.rod([.235, 1.255, .008], [.284, 1.478, .017], .043, green, .027);
  s.ball(.284, 1.475, .017, .038, light, [1, 1.05, 1], 0);
  s.cylinder(.286, 1.535, .017, .023, .029, .12, shade, 8);
  s.cylinder(.286, 1.604, .017, .062, .046, .045, COLORS.gold, 8);
  s.ball(.286, 1.674, .017, .067, '#efaa36', [.72, 1.25, .72], 0);
  s.cone(.299, 1.754, .017, .028, .1, '#ffe295', 5, 0);
  // Bent left arm cradles the tablet; robe folds run to the pedestal.
  s.rod([-.086, 1.02, .01], [-.184, .885, .117], .062, green, .043);
  s.box(-.148, .91, .137, .115, .183, .039, shade, [0, -.15, -.22]);
  s.box(-.155, .945, .16, .063, .009, .009, light, [0, 0, -.22]);
  for (const x of [-.11, -.052, .02, .09]) s.beam([x, .416, .116], [x * .61, .903, .078], .014, light, .01);
  s.box(-.035, .395, .145, .095, .029, .083, shade);
}

function cnTower(s) {
  s.plinth('#b9c3b0', .83, .72);
  s.cylinder(0, .56, 0, .071, .046, .96, '#e6dfc9', 3, [0, .2, 0]);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    s.beam([Math.sin(a) * .25, .08, Math.cos(a) * .25], [Math.sin(a) * .062, .78, Math.cos(a) * .062], .052, '#cccbbd');
  }
  s.cylinder(0, .996, 0, .09, .205, .15, '#e8deca', 12);
  s.cylinder(0, 1.085, 0, .205, .205, .06, '#456879', 12);
  s.cylinder(0, 1.14, 0, .23, .185, .05, COLORS.white, 12);
  s.cylinder(0, 1.205, 0, .15, .09, .08, '#9cabb0', 12);
  s.cylinder(0, 1.33, 0, .044, .027, .2, COLORS.white, 8);
  s.cylinder(0, 1.438, 0, .065, .056, .055, '#596d79', 10);
  for (let i = 0; i < 6; i++) s.cylinder(0, 1.492 + i * .045, 0, .018 - i * .0018, .016 - i * .0018, .045, i % 2 ? COLORS.white : '#bf5a50', 6);
  s.tree(-.29, .18, .2, '#789e70'); s.tree(.26, -.2, .23, '#a58a60');
}

function christRedeemer(s) {
  s.plinth('#7d9a77', .93, .8);
  s.cone(0, .3, -.03, .45, .45, '#6e8972', 7, 0);
  s.box(0, .37, .02, .33, .2, .29, '#a6aa91');
  s.box(0, .489, .02, .38, .055, .32, '#dddbc5');
  s.cylinder(0, .822, 0, .168, .095, .62, '#ecebdc', 7);
  s.ball(0, 1.135, 0, .129, '#ecebdc', [1.4, .75, .8], 0);
  s.cylinder(0, 1.255, .005, .039, .037, .12, '#ecebdc', 7);
  s.ball(0, 1.366, .012, .087, '#f8f5e6', [.82, 1.1, .87], 1);
  for (const side of [-1, 1]) {
    s.rod([side * .1, 1.15, 0], [side * .36, 1.158, .005], .065, '#ecebdc', .034, 7);
    s.rod([side * .36, 1.158, .005], [side * .45, 1.18, .008], .027, '#f8f5e6', .022, 6);
  }
  for (const x of [-.096, -.035, .035, .096]) s.beam([x, .54, .126], [x * .68, 1.069, .078], .012, '#c5cebf', .01);
  s.tree(-.33, .24, .23, '#416e58'); s.tree(.3, .25, .2, '#528364');
}

function buenosAiresObelisk(s) {
  s.plinth('#b9c2a0', .89, .8);
  s.box(0, .08, 0, .45, .035, .45, '#cec6b5');
  s.box(0, .119, 0, .34, .055, .34, '#eee4ce');
  s.cylinder(0, .785, 0, .143, .103, 1.28, '#eee9d9', 4, [0, Math.PI / 4, 0]);
  s.cone(0, 1.545, 0, .103, .24, '#fcf6e7', 4);
  s.box(0, .265, .104, .035, .11, .005, '#9c998b');
  for (let i = 0; i < 3; i++) s.box(0, .425 + i * .026, .102, .062 - i * .006, .006, .004, '#b8b09c');
  for (const x of [-.32, .32]) s.tree(x, .15, .26, '#b3a0cb');
  s.box(0, .074, .305, .27, .009, .1, '#e6ddc5');
}

function operaShell(s, x, z, length, width, height, yaw, color) {
  const positions = [], indices = [], rows = 7, columns = 8;
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    for (let j = 0; j <= columns; j++) {
      const v = j / columns * 2 - 1;
      positions.push((u - .5) * length, height * Math.sin(u * HALF_PI) * (1 - v * v), width * .5 * Math.sin(u * HALF_PI) * v);
      if (i < rows && j < columns) {
        const a = i * (columns + 1) + j, b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  s.add(geometry, color, [x, .18, z], [0, yaw, 0]);
  // Dark recessed glazing closes the high sail end and enhances its silhouette.
  const arch = [[-width / 2, 0]];
  for (let i = 0; i <= 8; i++) {
    const v = i / 8 * 2 - 1;
    arch.push([v * width / 2, height * (1 - v * v)]);
  }
  arch.push([width / 2, 0]);
  const endX = x + Math.cos(yaw) * (length / 2 - .004), endZ = z - Math.sin(yaw) * (length / 2 - .004);
  s.prism(arch, .008, '#416c79', [endX, .185, endZ], [0, yaw + HALF_PI, 0]);
}

function sydneyOperaHouse(s) {
  s.plinth('#76b9c4', 1.04, .87);
  s.box(0, .115, 0, .94, .09, .73, '#c7ac84');
  s.box(0, .17, 0, .89, .025, .69, '#e3c6a0');
  for (const [x, z, l, w, h, yaw] of [
    [-.22, -.18, .37, .25, .35, 0], [.025, -.18, .43, .29, .55, 0], [.29, -.16, .35, .25, .64, 0],
    [-.19, .16, .38, .26, .3, Math.PI], [.055, .16, .42, .31, .49, Math.PI], [.3, .14, .33, .24, .58, Math.PI],
  ]) operaShell(s, x, z, l, w, h, yaw, z < 0 ? '#fff8e8' : '#e3e7dd');
  for (let i = 0; i < 4; i++) s.box(-.445 + i * .021, .13 - i * .014, .26, .023, .02, .21, '#ddc29d');
}

function skyTower(s) {
  s.plinth('#9bad9b', .77, .71);
  s.cylinder(0, .13, 0, .2, .17, .12, '#d5cfb8', 10);
  s.cylinder(0, .572, 0, .068, .044, .81, '#e1dfca', 10);
  s.cylinder(0, .952, 0, .1, .18, .1, '#d6d8c9', 12);
  s.cylinder(0, 1.035, 0, .18, .18, .075, '#4c8c91', 12);
  s.cylinder(0, 1.087, 0, .22, .2, .035, '#e1dfca', 12);
  s.cylinder(0, 1.139, 0, .16, .12, .07, '#6fa6a4', 12);
  s.cone(0, 1.215, 0, .15, .09, '#d6d8c9', 12, 0);
  s.cylinder(0, 1.36, 0, .034, .028, .23, '#d6d8c9', 8);
  s.cylinder(0, 1.49, 0, .018, .014, .08, '#b16658', 6);
  s.cylinder(0, 1.628, 0, .011, .006, .19, '#e1dfca', 6);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    s.rod([Math.sin(a) * .15, 1.02, Math.cos(a) * .15], [Math.sin(a) * .045, .83, Math.cos(a) * .045], .011, '#e1dfca');
  }
  s.box(.23, .17, .17, .23, .16, .17, '#899a8e');
  s.tree(-.25, .2, .26, '#5d856d');
}

function gizaPyramids(s) {
  s.plinth('#dec18e', 1.03, .94);
  for (const [x, z, width, height] of [[-.18, -.09, .63, .63], [.28, .18, .38, .4], [-.3, .31, .22, .23]]) {
    const radius = width / Math.sqrt(2);
    s.cone(x, .07 + height / 2, z, radius, height, '#d2a969', 4);
    // Subtle alternating courses keep each pyramid faceted and readable.
    for (const level of [.23, .46, .69]) {
      const bottom = radius * (1 - level), bandHeight = .012;
      s.cylinder(x, .07 + height * level, z, bottom + radius * bandHeight / height / 2, bottom - radius * bandHeight / height / 2, bandHeight, '#c39a5c', 4, [0, Math.PI / 4, 0]);
    }
  }
  s.prism([[-.035, 0], [0, .056], [.035, 0]], .009, '#715943', [-.18, .084, .23]);
  for (const [x, z] of [[.37, -.32], [.42, -.23]]) s.ball(x, .1, z, .055, '#ebcc91', [1.1, .45, .8], 0);
}

function tableMountain(s) {
  s.plinth('#93aa7e', 1.04, .83);
  s.prism([[-.5, 0], [-.45, .22], [-.36, .31], [-.34, .59], [-.25, .64], [.24, .64], [.35, .59], [.39, .33], [.5, 0]], .44, '#9b9b83', [0, .075, -.035]);
  s.prism([[-.47, 0], [-.35, .18], [-.31, .53], [-.19, .55], [.18, .55], [.3, .52], [.37, .2], [.47, 0]], .08, '#b2ab8c', [0, .075, .224]);
  s.box(0, .73, -.035, .59, .035, .42, '#728e68');
  for (const [x, h, z] of [[-.33, .33, .23], [-.22, .43, .256], [.05, .45, .256], [.28, .35, .24]]) s.box(x, .11 + h / 2, z, .03, h, .014, '#878d75', [0, 0, x * .1]);
  s.cone(-.35, .205, .18, .2, .27, '#a6a183', 6, 0);
  s.cone(.36, .18, .13, .2, .23, '#aaa788', 6, .2);
  s.box(.22, .782, -.05, .12, .065, .1, '#e3d4b5');
  s.beam([-.31, .79, -.14], [.43, .845, .16], .008, '#596868');
  s.rod([.38, .842, .14], [.38, .75, .14], .009, '#596868');
  s.box(.38, .717, .14, .077, .077, .066, '#c56852');
  s.box(.38, .735, .175, .054, .026, .004, '#b6d4d0');
  s.tree(-.32, -.29, .17, '#587b5e');
}

const BUILDERS = new Map([
  [1, greatWall], [3, torii], [5, seoulTower], [6, marinaBay], [8, thaiTemple],
  [9, tajMahal], [11, eiffelTower], [12, brandenburgGate], [14, colosseum],
  [15, sagradaFamilia], [16, bigBen], [18, swissAlps], [20, statueOfLiberty],
  [21, cnTower], [23, christRedeemer], [24, buenosAiresObelisk],
  [26, sydneyOperaHouse], [27, skyTower], [29, gizaPyramids], [31, tableMountain],
]);

/**
 * Build a self-contained landmark group. Its local ground is y=0, the footprint
 * is centered on x=z=0 and fits in 1.04 × 1.04, and its height is at most 1.78.
 * Meshes own their geometry/materials and may be safely disposed independently.
 * Non-property board tiles return an empty Group.
 * @param {{ id: number|string, name?: string }} tile
 * @returns {THREE.Group}
 */
export function createLandmark(tile) {
  const id = Number(tile?.id);
  const sculpture = new Sculpture();
  BUILDERS.get(id)?.(sculpture);
  return sculpture.finish(id);
}
