import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeterministicPhotoPath,
  classifyExitSnapshot,
  createExitOperation,
  sameInstant,
} from '../src/app/core/sync-invariants.ts';

const expected = {
  remoteAttendanceId: '11',
  userId: 'user-1',
  plantaoId: 'plantao-1',
  occurredAt: '2026-11-18T11:16:03.794Z',
  photoPath: 'user-1/plantao-1/operation-1.jpg',
  reason: 'Teste final de registro de ponto',
};

const snapshot = (overrides = {}) => ({
  id: 11,
  usuario_id: expected.userId,
  plantao_id: expected.plantaoId,
  data_hora_saida: '2026-11-18T11:16:03.794+00:00',
  foto_saida: expected.photoPath,
  justificativa: expected.reason,
  ...overrides,
});

test('enqueue helper creates and persists the deterministic photo path in the operation', () => {
  const path = buildDeterministicPhotoPath(expected.userId, expected.plantaoId, 'captura.JPG', 'operation-1');
  assert.equal(path, expected.photoPath);
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
  const operation = createExitOperation({
    id: 'operation-1', userId: expected.userId, plantaoId: expected.plantaoId,
    localAttendanceId: 'local-1', remoteAttendanceId: '11',
    occurredAt: expected.occurredAt, createdAt: expected.occurredAt,
    photoBlob: blob, photoName: 'captura.JPG', photoType: 'image/jpeg',
    reason: expected.reason, wasOffline: true, photoPath: path,
  });
  assert.equal(operation.photoPath, path);
  assert.equal(operation.photoBlob, blob);
  assert.equal(operation.photoSize, 4);
  assert.equal(operation.reason, expected.reason);
  assert.equal(operation.wasOffline, true);
});

test('equivalent ISO timestamps with different UTC notation are accepted', () => {
  assert.equal(sameInstant('2026-11-18T11:16:03.794+00:00', expected.occurredAt), true);
  assert.equal(classifyExitSnapshot(snapshot(), expected), 'confirmed');
});

test('different or invalid timestamps are rejected', () => {
  assert.equal(sameInstant('2026-11-18T11:16:04.794Z', expected.occurredAt), false);
  assert.equal(sameInstant(null, expected.occurredAt), false);
  assert.equal(sameInstant('invalid', expected.occurredAt), false);
  assert.equal(classifyExitSnapshot(snapshot({ data_hora_saida: 'invalid' }), expected), 'conflict');
});

test('a matching recorded exit is confirmed without requesting another update', () => {
  const beforeRetry = snapshot();
  assert.equal(classifyExitSnapshot(beforeRetry, expected), 'confirmed');
});

test('a response-loss retry can recover committed exit; only matching confirmation is synced', () => {
  const remoteAfterLostResponse = snapshot();
  assert.equal(classifyExitSnapshot(remoteAfterLostResponse, expected), 'confirmed');
  assert.notEqual(classifyExitSnapshot(snapshot({ foto_saida: 'different/path.jpg' }), expected), 'confirmed');
  assert.notEqual(classifyExitSnapshot(snapshot({ justificativa: 'outra justificativa' }), expected), 'confirmed');
  assert.notEqual(classifyExitSnapshot(snapshot({ id: 'local-uuid' }), expected), 'confirmed');
});

test('only the correct open attendance can proceed to a first update', () => {
  assert.equal(classifyExitSnapshot(snapshot({ data_hora_saida: null, foto_saida: null }), expected), 'open');
  assert.equal(classifyExitSnapshot(snapshot({ plantao_id: 'other-plantao', data_hora_saida: null }), expected), 'conflict');
  assert.equal(classifyExitSnapshot(null, expected), 'missing');
});
