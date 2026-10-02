import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOARD } from '../src/game.js';
import { createDie, diceOrientation, tilePoint } from '../src/world.js';
import { createLandmark, LANDMARK_NAMES } from '../src/landmarks.js';

test('the physical die has six pip faces with opposite values summing to seven', () => {
  const die = createDie();
  const faces = die.children.filter(child => Number.isInteger(child.userData.value));
  assert.deepEqual(faces.map(face => face.userData.value).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  const normals = faces.map(face => new THREE.Vector3(0, 0, 1).applyQuaternion(face.quaternion));
  for (const [index, face] of faces.entries()) {
    const pips = face.children.filter(child => child.isMesh);
    assert.equal(pips.length, face.userData.value);
    assert.ok(pips.every(pip => pip.geometry.getAttribute('position').count > 0));
    const opposite = normals.findIndex(normal => normal.dot(normals[index]) < -0.999999);
    assert.notEqual(opposite, -1);
    assert.equal(face.userData.value + faces[opposite].userData.value, 7);
    assert.equal(normals.filter(normal => normal.dot(normals[index]) > 0.999999).length, 1);
  }
  const bounds = new THREE.Box3().setFromObject(die);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x > 1 && size.y > 1 && size.z > 1, 'the die must have depth on all three axes');
});

test('every displayed dice value rotates its actual pip face to the upper surface', () => {
  const die = createDie();
  const up = new THREE.Vector3(0, 1, 0);
  for (let value = 1; value <= 6; value++) {
    const orientation = diceOrientation(value);
    assert.ok(Math.abs(orientation.length() - 1) < 1e-9);
    die.quaternion.copy(orientation);
    die.updateMatrixWorld(true);
    const face = die.children.find(child => child.userData.value === value);
    const faceOrientation = face.getWorldQuaternion(new THREE.Quaternion());
    const actualNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(faceOrientation);
    assert.ok(actualNormal.distanceTo(up) < 1e-9, `face ${value} must be on top after settling`);
    for (const pip of face.children) {
      const position = pip.getWorldPosition(new THREE.Vector3());
      assert.ok(position.y > .5, `face ${value}'s visible pips must lie on the upper surface`);
    }
  }
});

test('all 32 board positions form a closed, evenly spaced perimeter without overlaps', () => {
  const points = BOARD.map(tile => tilePoint(tile.id));
  assert.equal(points.length, 32);
  assert.equal(new Set(points.map(point => point.toArray().join(','))).size, 32);
  const spacing = points[0].distanceTo(points[1]);
  assert.ok(spacing > 1);
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    assert.ok(current.toArray().every(Number.isFinite));
    assert.equal(current.y, points[0].y);
    assert.ok(Math.abs(current.distanceTo(next) - spacing) < 1e-9, `tile ${index} must adjoin the next tile`);
    assert.ok(Math.abs(current.x - next.x) < 1e-9 || Math.abs(current.z - next.z) < 1e-9, 'movement follows one board edge at a time');
  }
  const corners = [points[0], points[8], points[16], points[24]];
  for (let index = 0; index < corners.length; index++) {
    assert.ok(Math.abs(corners[index].distanceTo(corners[(index + 1) % corners.length]) - 8 * spacing) < 1e-9);
  }
});

test('all twenty countries have named volumetric landmarks that fit within their board plots', () => {
  const countries = BOARD.filter(tile => tile.type === 'property');
  assert.equal(countries.length, 20);
  assert.deepEqual(Object.keys(LANDMARK_NAMES).map(Number).sort((a, b) => a - b), countries.map(tile => tile.id));
  for (const tile of countries) {
    const landmark = createLandmark(tile);
    assert.ok(landmark.isGroup);
    assert.equal(typeof LANDMARK_NAMES[tile.id], 'string');
    assert.ok(LANDMARK_NAMES[tile.id].length > 0);
    const meshes = [];
    landmark.traverse(object => { if (object.isMesh) meshes.push(object); });
    assert.ok(meshes.length > 0, `${tile.name} needs actual model geometry`);
    for (const object of meshes) {
      const positions = object.geometry.getAttribute('position');
      assert.ok(positions && positions.count >= 3);
      assert.ok([...positions.array].every(Number.isFinite), `${tile.name} contains invalid vertex coordinates`);
      assert.ok(object.material);
      assert.equal(object.castShadow, true);
      assert.equal(object.receiveShadow, true);
    }
    const bounds = new THREE.Box3().setFromObject(landmark);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    assert.ok(size.x > .05 && size.y > .05 && size.z > .05, `${tile.name} must have volume on every axis`);
    assert.ok(size.x <= 1.040001 && size.z <= 1.040001, `${tile.name} exceeds the plot footprint`);
    assert.ok(size.y <= 1.780001, `${tile.name} exceeds the landmark height budget`);
    assert.ok(Math.abs(bounds.min.y) <= 1e-6, `${tile.name} must sit on the ground`);
    assert.ok(Math.abs(center.x) <= 1e-6 && Math.abs(center.z) <= 1e-6, `${tile.name} must be centered on its plot`);
  }
  for (const tile of BOARD.filter(tile => tile.type !== 'property')) {
    assert.equal(createLandmark(tile).children.length, 0, `special tile ${tile.id} must not inherit a country's landmark`);
  }
});
