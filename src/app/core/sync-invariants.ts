export interface ExitOperationInput {
  id: string;
  userId: string;
  plantaoId: string;
  localAttendanceId: string;
  remoteAttendanceId?: string;
  occurredAt: string;
  createdAt: string;
  photoBlob: Blob;
  photoName: string;
  photoType: string;
  reason: string;
  wasOffline: boolean;
  photoPath: string;
}

export interface RemoteExitSnapshot {
  id: string | number | null;
  usuario_id: string | null;
  plantao_id: string | null;
  data_hora_saida: string | null;
  foto_saida: string | null;
  justificativa: string | null;
}

export type ExitSnapshotState = 'missing' | 'open' | 'confirmed' | 'conflict';

export function buildDeterministicPhotoPath(
  userId: string,
  plantaoId: string,
  photoName: string,
  operationId: string,
): string {
  const extension = photoName.split('.').pop()?.toLowerCase() || 'jpg';
  return `${userId}/${plantaoId}/${operationId}.${extension}`;
}

export function createExitOperation(input: ExitOperationInput) {
  return {
    ...input,
    kind: 'Saída' as const,
    createPlantao: false,
    photoSize: input.photoBlob.size,
    status: 'pending' as const,
    retryCount: 0,
  };
}

export function sameInstant(received: string | null | undefined, expected: string | null | undefined): boolean {
  if (received == null || expected == null) return false;
  const receivedTime = Date.parse(received);
  const expectedTime = Date.parse(expected);
  return Number.isFinite(receivedTime) && Number.isFinite(expectedTime) && receivedTime === expectedTime;
}

export function classifyExitSnapshot(
  snapshot: RemoteExitSnapshot | null,
  expected: {
    remoteAttendanceId: string;
    userId: string;
    plantaoId: string;
    occurredAt: string;
    photoPath: string;
    reason: string | null;
  },
): ExitSnapshotState {
  if (!snapshot) return 'missing';
  if (snapshot.id == null || String(snapshot.id) !== expected.remoteAttendanceId ||
      snapshot.usuario_id !== expected.userId || snapshot.plantao_id !== expected.plantaoId) return 'conflict';
  if (snapshot.data_hora_saida == null) return 'open';
  return sameInstant(snapshot.data_hora_saida, expected.occurredAt) &&
    snapshot.foto_saida === expected.photoPath &&
    (snapshot.justificativa ?? null) === expected.reason
    ? 'confirmed'
    : 'conflict';
}
