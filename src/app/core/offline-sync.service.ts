import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { PlantaoService } from './plantao.service';
import { PlantaoServiceError } from './plantao.service';
import type { Atendimento, Plantao, PlantaoFailureKind } from './plantao.service';

export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'synced';
export type SyncErrorCode = PlantaoFailureKind | 'no-internet' | 'unknown';
const INITIAL_SYNC_WAIT_MS = 8_000;
const RETRY_BASE_MS = 45_000;
const RETRY_MAX_MS = 30 * 60_000;
export type OfflineRecordKind = 'Entrada' | 'Saída';

export interface OfflineOperation {
  id: string;
  userId: string;
  kind: OfflineRecordKind;
  plantaoId: string;
  /** UUID usado somente para correlacionar operações locais do mesmo atendimento. */
  localAttendanceId: string;
  /** atendimentos.id remoto (BIGINT), armazenado como string decimal. */
  remoteAttendanceId?: string;
  /** Campo legado mantido apenas para migração transparente da fila existente. */
  atendimentoId?: string;
  createPlantao: boolean;
  occurredAt: string;
  createdAt: string;
  photoBlob?: Blob;
  photoName: string;
  photoType: string;
  photoSize: number;
  photoPath?: string;
  reason: string;
  wasOffline: boolean;
  status: SyncStatus;
  retryCount: number;
  lastAttemptAt?: string;
  syncError?: string;
  syncErrorCode?: SyncErrorCode;
  retryDisposition?: 'automatic' | 'manual';
  nextRetryAt?: string;
  syncedAt?: string;
  /** Versão do protocolo que confirmou Storage, atendimento e ID remoto. */
  confirmationVersion?: number;
}

export interface OfflineContext {
  userId: string;
  plantaoId: string;
  plantaoStartAt: string;
  plantaoSynced: boolean;
  localAttendanceId: string | null;
  remoteAttendanceId?: string | null;
  /** Campo legado mantido apenas para migração transparente do contexto existente. */
  atendimentoId?: string | null;
  atendimentoStartAt: string | null;
}

const DATABASE_NAME = 'meu-plantao-offline';
const DATABASE_VERSION = 1;

@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private readonly auth = inject(AuthService);
  private readonly plantaoService = inject(PlantaoService);
  private databasePromise?: Promise<IDBDatabase>;
  private syncPromise?: Promise<void>;
  private retryTimer?: number;

  readonly operations = signal<OfflineOperation[]>([]);
  readonly pendingCount = computed(() => this.operations().filter(operation => operation.status !== 'synced').length);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly syncing = signal(false);
  readonly storageError = signal('');

  clearVisibleOperations(): void { this.operations.set([]); }

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    this.retryTimer = window.setInterval(() => void this.syncNow(), 45_000);
    void this.initialize();
  }

  async initialize(): Promise<void> {
    try {
      const userId = await this.auth.restoreCurrentUserId();
      if (!userId) return;
      await this.refresh(userId, true);
      if (this.online()) void this.syncNow(userId, undefined, true);
    } catch (error) {
      this.storageError.set(this.errorMessage(error));
    }
  }

  async getOperations(userId: string): Promise<OfflineOperation[]> {
    const db = await this.database();
    const tx = db.transaction('operations', 'readonly');
    const done = this.transactionDone(tx);
    const request = tx.objectStore('operations').index('userId').getAll(userId);
    const values = await this.requestResult<OfflineOperation[]>(request);
    await done;
    const normalized = values.map(operation => this.normalizeOperation(operation));
    for (let index = 0; index < normalized.length; index++) {
      if (normalized[index] !== values[index]) await this.putOperation(normalized[index]);
    }
    return normalized.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getBlockingOperation(userId: string, operationId: string): Promise<OfflineOperation | null> {
    const operations = await this.getOperations(userId);
    const target = operations.find(operation => operation.id === operationId);
    if (!target) return null;
    return operations.find(operation => operation.plantaoId === target.plantaoId &&
      operation.createdAt < target.createdAt && operation.status !== 'synced') ?? null;
  }

  async getContext(userId: string): Promise<OfflineContext | null> {
    const db = await this.database();
    const tx = db.transaction('contexts', 'readonly');
    const done = this.transactionDone(tx);
    const request = tx.objectStore('contexts').get(userId);
    const context = await this.requestResult<OfflineContext | undefined>(request);
    await done;
    if (!context) return null;
    const normalized = this.normalizeContext(context);
    if (normalized !== context) await this.putContext(normalized);
    return normalized;
  }

  private normalizeOperation(operation: OfflineOperation): OfflineOperation {
    const legacyId = operation.atendimentoId;
    const isRemoteId = typeof legacyId === 'string' && /^\d+$/.test(legacyId);
    if (operation.localAttendanceId && !Object.prototype.hasOwnProperty.call(operation, 'atendimentoId')) return operation;
    const migrated: OfflineOperation = {
      ...operation,
      localAttendanceId: operation.localAttendanceId ?? (legacyId && !isRemoteId ? legacyId : crypto.randomUUID()),
      remoteAttendanceId: operation.remoteAttendanceId ?? (isRemoteId ? legacyId : undefined),
    };
    delete migrated.atendimentoId;
    return migrated;
  }

  private normalizeContext(context: OfflineContext): OfflineContext {
    const legacyId = context.atendimentoId;
    const isRemoteId = typeof legacyId === 'string' && /^\d+$/.test(legacyId);
    if (Object.prototype.hasOwnProperty.call(context, 'localAttendanceId') && !Object.prototype.hasOwnProperty.call(context, 'atendimentoId')) return context;
    const migrated: OfflineContext = {
      ...context,
      localAttendanceId: context.localAttendanceId ?? (legacyId && !isRemoteId ? legacyId : null),
      remoteAttendanceId: context.remoteAttendanceId ?? (isRemoteId ? legacyId : null),
    };
    delete migrated.atendimentoId;
    return migrated;
  }

  async saveServerContext(plantao: Plantao | null, atendimento: Atendimento | null, userId: string): Promise<void> {
    if (!plantao) return;
    const existing = await this.getContext(userId);
    const context: OfflineContext = {
      userId,
      plantaoId: plantao.id,
      plantaoStartAt: plantao.data_hora_inicio,
      plantaoSynced: true,
      localAttendanceId: atendimento?.localAttendanceId ?? null,
      remoteAttendanceId: atendimento?.id ?? null,
      atendimentoStartAt: atendimento?.data_hora_entrada ?? null,
    };
    if (existing?.plantaoId === plantao.id && !atendimento) {
      const unconfirmed = (await this.getOperations(userId))
        .filter(operation => operation.plantaoId === plantao.id && operation.status !== 'synced')
        .at(-1);
      if (unconfirmed?.kind === 'Entrada') {
        context.localAttendanceId = unconfirmed.localAttendanceId;
        context.remoteAttendanceId = unconfirmed.remoteAttendanceId ?? null;
        context.atendimentoStartAt = unconfirmed.occurredAt;
      }
    }
    await this.putContext(context);
  }

  async clearContextIfNoPending(userId: string): Promise<void> {
    const pending = (await this.getOperations(userId)).some(operation => operation.status !== 'synced');
    if (pending) return;
    const db = await this.database();
    const tx = db.transaction('contexts', 'readwrite');
    const done = this.transactionDone(tx);
    tx.objectStore('contexts').delete(userId);
    await done;
  }

  async enqueueEntry(
    userId: string,
    plantao: Plantao | null,
    photo: File,
    occurredAt: Date,
    reason: string,
    onSyncStart?: () => void,
  ): Promise<OfflineOperation> {
    this.refreshConnectionState();
    const savedContext = await this.getContext(userId);
    const plantaoId = plantao?.id ?? savedContext?.plantaoId ?? crypto.randomUUID();
    const createPlantao = !plantao && !savedContext?.plantaoSynced;
    const localAttendanceId = crypto.randomUUID();
    const operation: OfflineOperation = {
      id: crypto.randomUUID(),
      userId,
      kind: 'Entrada',
      plantaoId,
      localAttendanceId,
      createPlantao,
      occurredAt: occurredAt.toISOString(),
      createdAt: new Date().toISOString(),
      photoBlob: photo,
      photoName: photo.name,
      photoType: photo.type || 'application/octet-stream',
      photoSize: photo.size,
      reason,
      wasOffline: !this.online(),
      status: 'pending',
      retryCount: 0,
    };
    const context: OfflineContext = {
      userId,
      plantaoId,
      plantaoStartAt: plantao?.data_hora_inicio ?? savedContext?.plantaoStartAt ?? occurredAt.toISOString(),
      plantaoSynced: !createPlantao,
      localAttendanceId,
      remoteAttendanceId: null,
      atendimentoStartAt: occurredAt.toISOString(),
    };
    await this.putOperationAndContext(operation, context);
    await this.refresh(userId);
    if (this.online()) {
      onSyncStart?.();
      await this.syncNow(userId, operation.id, true);
    } else {
      await this.markNoInternet(operation);
    }
    return (await this.getOperations(userId)).find(item => item.id === operation.id) ?? operation;
  }

  async enqueueExit(
    userId: string,
    plantao: Plantao,
    atendimento: Atendimento,
    photo: File,
    occurredAt: Date,
    reason: string,
    onSyncStart?: () => void,
  ): Promise<OfflineOperation> {
    this.refreshConnectionState();
    const operation: OfflineOperation = {
      id: crypto.randomUUID(),
      userId,
      kind: 'Saída',
      plantaoId: plantao.id,
      localAttendanceId: atendimento.localAttendanceId ?? crypto.randomUUID(),
      remoteAttendanceId: /^\d+$/.test(String(atendimento.id)) ? String(atendimento.id) : undefined,
      createPlantao: false,
      occurredAt: occurredAt.toISOString(),
      createdAt: new Date().toISOString(),
      photoBlob: photo,
      photoName: photo.name,
      photoType: photo.type || 'application/octet-stream',
      photoSize: photo.size,
      reason,
      wasOffline: !this.online(),
      status: 'pending',
      retryCount: 0,
    };
    const context: OfflineContext = {
      userId,
      plantaoId: plantao.id,
      plantaoStartAt: plantao.data_hora_inicio,
      plantaoSynced: true,
      localAttendanceId: atendimento.localAttendanceId ?? null,
      remoteAttendanceId: /^\d+$/.test(String(atendimento.id)) ? String(atendimento.id) : null,
      atendimentoStartAt: null,
    };
    await this.putOperationAndContext(operation, context);
    await this.refresh(userId);
    if (this.online()) {
      onSyncStart?.();
      await this.syncNow(userId, operation.id, true);
    } else {
      await this.markNoInternet(operation);
    }
    return (await this.getOperations(userId)).find(item => item.id === operation.id) ?? operation;
  }

  async refresh(userId: string, recoverStale = false): Promise<void> {
    const list = await this.getOperations(userId);
    let normalized = false;
    for (const operation of list) {
      if (recoverStale && operation.status === 'syncing') {
        operation.status = 'pending';
        operation.syncError = undefined;
        operation.syncErrorCode = undefined;
        operation.retryDisposition = undefined;
        operation.nextRetryAt = undefined;
        await this.putOperation(operation);
        normalized = true;
      } else if (operation.status === 'failed' && !operation.retryDisposition) {
        operation.retryDisposition = this.isTransientStoredFailure(operation) ? 'automatic' : 'manual';
        if (operation.retryDisposition === 'automatic') {
          operation.nextRetryAt = new Date(Date.now() + this.retryDelay(operation.retryCount)).toISOString();
        }
        await this.putOperation(operation);
        normalized = true;
      }
    }
    this.operations.set(normalized ? await this.getOperations(userId) : list);
  }

  async syncNow(userId = this.auth.currentUserId() ?? undefined, targetOperationId?: string, retryNoInternet = false): Promise<SyncStatus | undefined> {
    if (!userId) return undefined;
    this.refreshConnectionState();
    if (!this.online()) {
      if (targetOperationId) {
        const operation = (await this.getOperations(userId)).find(item => item.id === targetOperationId);
        if (operation) await this.markNoInternet(operation);
      }
      return targetOperationId ? (await this.getOperations(userId)).find(item => item.id === targetOperationId)?.status : undefined;
    }

    if (targetOperationId) {
      const target = (await this.getOperations(userId)).find(item => item.id === targetOperationId);
      if (!target || target.status === 'synced') return target?.status;
    }

    if (retryNoInternet) {
      const operations = await this.getOperations(userId);
      for (const operation of operations) {
        if (operation.status !== 'pending' || operation.syncErrorCode !== 'no-internet') continue;
        operation.syncError = undefined;
        operation.syncErrorCode = undefined;
        operation.nextRetryAt = undefined;
        await this.putOperation(operation);
      }
    }

    const deadline = Date.now() + INITIAL_SYNC_WAIT_MS;
    let startedTargetRun = false;
    while (true) {
      if (!this.syncPromise) {
        this.syncPromise = this.performSync(userId, targetOperationId).finally(() => { this.syncPromise = undefined; });
        startedTargetRun = true;
      }
      const currentRun = this.syncPromise;
      const remaining = Math.max(0, deadline - Date.now());
      const finished = await Promise.race([
        currentRun.then(() => true),
        new Promise<boolean>(resolve => window.setTimeout(() => resolve(false), remaining)),
      ]);
      await this.refresh(userId).catch(error => this.storageError.set(this.errorMessage(error)));
      const operation = targetOperationId
        ? (await this.getOperations(userId)).find(item => item.id === targetOperationId)
        : undefined;
      if (!targetOperationId || !operation) return undefined;
      if (operation.status === 'synced' || operation.status === 'failed' || !finished) return operation.status;
      if (operation.status === 'pending' && !this.online()) return operation.status;
      if (operation.status === 'pending' && startedTargetRun) return operation.status;
      if (Date.now() >= deadline) return operation.status;
    }
  }

  private async markNoInternet(operation: OfflineOperation): Promise<void> {
    operation.status = 'pending';
    operation.syncErrorCode = 'no-internet';
    operation.syncError = 'Sem conexão com a internet. A operação continua salva no dispositivo.';
    await this.putOperation(operation);
    await this.refresh(operation.userId);
  }

  private async performSync(userId: string, targetOperationId?: string): Promise<void> {
    this.syncing.set(true);
    this.storageError.set('');
    try {
      const allOperations = await this.getOperations(userId);
      const target = targetOperationId ? allOperations.find(operation => operation.id === targetOperationId) : undefined;
      if (targetOperationId && !target) return;
      const operations = allOperations.filter(operation => !targetOperationId ||
        (target && operation.plantaoId === target.plantaoId && operation.createdAt <= target.createdAt));
      const groups = new Map<string, OfflineOperation[]>();
      for (const operation of operations) {
        const group = groups.get(operation.plantaoId) ?? [];
        group.push(operation);
        groups.set(operation.plantaoId, group);
      }
      for (const group of groups.values()) {
        group.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const operation of group) {
          if (operation.status === 'synced') continue;
          if (operation.status === 'syncing') break;
          if (operation.status !== 'pending' && operation.status !== 'failed') break;
          const selectedManualRetry = operation.id === targetOperationId;
          if (operation.status === 'pending' && operation.syncErrorCode === 'no-internet' && !selectedManualRetry) break;
          if (operation.status === 'failed') {
            if (operation.retryDisposition === 'manual' && !selectedManualRetry) break;
            if (!selectedManualRetry && operation.retryDisposition !== 'automatic') break;
            if (!selectedManualRetry && operation.nextRetryAt && Date.parse(operation.nextRetryAt) > Date.now()) break;
          }
          if (!this.online() || this.auth.currentUserId() !== userId) break;
          const previousSyncError = operation.syncError;
          const attemptAt = new Date().toISOString();
          operation.status = 'syncing';
          operation.retryCount += 1;
          operation.lastAttemptAt = attemptAt;
          operation.syncError = undefined;
          operation.syncErrorCode = undefined;
          operation.retryDisposition = undefined;
          operation.nextRetryAt = undefined;
          await this.putOperation(operation);
          await this.refresh(userId);
          console.info('[offline-sync] tentativa iniciada', {
            operationId: operation.id,
            localAttendanceId: operation.localAttendanceId,
            remoteAttendanceId: operation.remoteAttendanceId ?? null,
            functionName: operation.kind === 'Entrada' ? 'PlantaoService.startAtendimento' : 'PlantaoService.finishAtendimento',
            table: 'atendimentos',
            attemptAt,
            retryCount: operation.retryCount,
            previousSyncError,
          });
          try {
            const result = await this.syncOperation(operation);
            operation.photoPath = result.photoPath;
            operation.remoteAttendanceId = result.remoteAttendanceId;
            operation.syncError = undefined;
            operation.syncErrorCode = undefined;
            operation.retryDisposition = undefined;
            operation.nextRetryAt = undefined;
            await this.persistAttendanceMapping(userId, operation, result.remoteAttendanceId);
            await this.markPlantaoSynced(userId, operation.plantaoId);
            operation.status = 'synced';
            operation.syncedAt = new Date().toISOString();
            operation.confirmationVersion = 1;
            await this.putOperation(operation);
          } catch (error) {
            console.error('[offline-sync] tentativa falhou', {
              operationId: operation.id,
              localAttendanceId: operation.localAttendanceId,
              remoteAttendanceId: operation.remoteAttendanceId ?? null,
              functionName: operation.kind === 'Entrada' ? 'PlantaoService.startAtendimento' : 'PlantaoService.finishAtendimento',
              table: 'atendimentos',
              attemptAt,
              error: this.diagnosticError(error),
            });
            if (!this.online() || this.isCommunicationFailure(error)) {
              operation.status = 'pending';
              operation.syncErrorCode = 'no-internet';
              operation.syncError = 'Sem confirmação do Supabase. A operação continua salva no dispositivo.';
            } else {
              operation.status = 'failed';
              operation.syncErrorCode = this.classifyError(error);
              operation.syncError = this.errorMessage(error);
              if (this.isTransientError(error)) {
                operation.retryDisposition = 'automatic';
                operation.nextRetryAt = new Date(Date.now() + this.retryDelay(operation.retryCount)).toISOString();
              } else {
                operation.retryDisposition = 'manual';
                operation.nextRetryAt = undefined;
              }
            }
            await this.putOperation(operation);
            break;
          }
          await this.refresh(userId);
        }
      }
    } catch (error) {
      this.storageError.set(this.errorMessage(error));
    } finally {
      this.syncing.set(false);
      await this.refresh(userId).catch(error => this.storageError.set(this.errorMessage(error)));
    }
  }

  private diagnosticError(error: unknown): unknown {
    if (error instanceof PlantaoServiceError) {
      const cause = error.cause as { code?: string; message?: string; details?: string; hint?: string } | undefined;
      return { name: error.name, kind: error.kind, message: error.message, cause: cause ? { code: cause.code, message: cause.message, details: cause.details, hint: cause.hint } : undefined };
    }
    if (error instanceof Error) return { name: error.name, message: error.message };
    return error;
  }

  private async syncOperation(operation: OfflineOperation): Promise<{ photoPath: string; remoteAttendanceId: string }> {
    this.refreshConnectionState();
    if (!this.online()) throw new PlantaoServiceError('communication', 'Sem conexão; o envio não foi iniciado.');
    if (!operation.photoBlob) throw new Error('A fotografia local desta operação não está disponível.');
    if (operation.kind === 'Entrada' && operation.createPlantao) {
      await this.plantaoService.startPlantao(operation.occurredAt, operation.plantaoId);
    }
    this.refreshConnectionState();
    if (!this.online()) throw new PlantaoServiceError('communication', 'Sem conexão; o envio da fotografia não foi iniciado.');
    const file = new File([operation.photoBlob], operation.photoName, { type: operation.photoType, lastModified: Date.parse(operation.createdAt) });
    const photoPath = await this.plantaoService.uploadPhoto(file, operation.plantaoId, operation.id);
    this.refreshConnectionState();
    if (!this.online()) throw new PlantaoServiceError('communication', 'A conexão foi interrompida depois do upload; o atendimento ainda não foi confirmado.');
    let remoteAttendanceId = operation.remoteAttendanceId;
    if (operation.kind === 'Entrada') {
      const atendimento = await this.plantaoService.startAtendimento(operation.plantaoId, operation.occurredAt, photoPath, operation.reason || null, operation.id, operation.localAttendanceId);
      remoteAttendanceId = atendimento.id;
    } else {
      remoteAttendanceId ??= (await this.getOperations(operation.userId))
        .find(candidate => candidate.kind === 'Entrada' && candidate.plantaoId === operation.plantaoId && candidate.localAttendanceId === operation.localAttendanceId)?.remoteAttendanceId;
      if (!remoteAttendanceId || !/^\d+$/.test(remoteAttendanceId)) {
        throw new PlantaoServiceError('record-write', 'A saída aguarda a confirmação do atendimento de entrada correspondente.');
      }
      await this.plantaoService.finishAtendimento(remoteAttendanceId, operation.occurredAt, photoPath, operation.reason || null, operation.id, operation.localAttendanceId);
    }
    if (!remoteAttendanceId || !/^\d+$/.test(remoteAttendanceId)) {
      throw new PlantaoServiceError('record-write', 'O Supabase não retornou um ID BIGINT válido para o atendimento.');
    }
    return { photoPath, remoteAttendanceId };
  }

  private async persistAttendanceMapping(userId: string, operation: OfflineOperation, remoteAttendanceId: string): Promise<void> {
    const operations = await this.getOperations(userId);
    for (const related of operations) {
      if (related.plantaoId === operation.plantaoId && related.localAttendanceId === operation.localAttendanceId) {
        related.remoteAttendanceId = remoteAttendanceId;
        await this.putOperation(related);
      }
    }
    const context = await this.getContext(userId);
    if (context?.plantaoId === operation.plantaoId && context.localAttendanceId === operation.localAttendanceId) {
      context.remoteAttendanceId = remoteAttendanceId;
      await this.putContext(context);
    }
  }

  private async markPlantaoSynced(userId: string, plantaoId: string): Promise<void> {
    const context = await this.getContext(userId);
    if (context?.plantaoId === plantaoId && !context.plantaoSynced) {
      context.plantaoSynced = true;
      await this.putContext(context);
    }
  }

  private async putOperation(operation: OfflineOperation): Promise<void> {
    const db = await this.database();
    const tx = db.transaction('operations', 'readwrite');
    const done = this.transactionDone(tx);
    tx.objectStore('operations').put(operation);
    await done;
  }

  private async putContext(context: OfflineContext): Promise<void> {
    const db = await this.database();
    const tx = db.transaction('contexts', 'readwrite');
    const done = this.transactionDone(tx);
    tx.objectStore('contexts').put(context);
    await done;
  }

  private async putOperationAndContext(operation: OfflineOperation, context: OfflineContext): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(['operations', 'contexts'], 'readwrite');
    const done = this.transactionDone(tx);
    tx.objectStore('operations').put(operation);
    tx.objectStore('contexts').put(context);
    await done;
  }

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Este navegador não oferece armazenamento local seguro para o modo offline.'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('operations')) {
          const operations = db.createObjectStore('operations', { keyPath: 'id' });
          operations.createIndex('userId', 'userId', { unique: false });
          operations.createIndex('plantaoId', 'plantaoId', { unique: false });
        }
        if (!db.objectStoreNames.contains('contexts')) db.createObjectStore('contexts', { keyPath: 'userId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento local.'));
      request.onblocked = () => reject(new Error('O armazenamento local está ocupado por outra aba.'));
    });
    return this.databasePromise;
  }

  private requestResult<T>(request: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('Falha ao ler os dados locais.'));
    });
  }

  private transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Falha ao gravar no armazenamento local.'));
      tx.onabort = () => reject(tx.error ?? new Error('A gravação local foi interrompida.'));
    });
  }

  private readonly handleOnline = (): void => {
    this.online.set(true);
    void this.syncNow(undefined, undefined, true);
  };

  private readonly handleOffline = (): void => { this.online.set(false); };

  private refreshConnectionState(): void {
    this.online.set(typeof navigator === 'undefined' ? this.online() : navigator.onLine);
  }

  private classifyError(error: unknown): SyncErrorCode {
    if (error instanceof PlantaoServiceError) return error.kind;
    if (error instanceof TypeError || (error instanceof Error && /failed to fetch|network|timeout|timed out/i.test(error.message))) return 'communication';
    return 'unknown';
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof PlantaoServiceError) {
      if (error.kind === 'communication' || error.kind === 'supabase-unavailable') return true;
      if (error.kind === 'photo-upload' && /temporária de comunicação|http 5\d\d/i.test(error.message)) return true;
      return false;
    }
    if (error instanceof TypeError || (error instanceof Error && /failed to fetch|network|timeout|timed out/i.test(error.message))) return true;
    return false;
  }

  private isCommunicationFailure(error: unknown): boolean {
    if (error instanceof PlantaoServiceError) {
      return error.kind === 'communication' ||
        (error.kind === 'photo-upload' && /falha temporária de comunicação/i.test(error.message));
    }
    return error instanceof TypeError ||
      (error instanceof Error && /failed to fetch|network|timeout|timed out|aborterror/i.test(error.message));
  }

  private isTransientStoredFailure(operation: OfflineOperation): boolean {
    if (operation.syncErrorCode === 'communication' || operation.syncErrorCode === 'supabase-unavailable') return true;
    if (operation.syncErrorCode === 'photo-upload' && /temporária de comunicação|http 5\d\d/i.test(operation.syncError ?? '')) return true;
    return false;
  }

  private retryDelay(retryCount: number): number {
    return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, retryCount - 1), RETRY_MAX_MS);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof PlantaoServiceError) return error.message;
    return error instanceof Error ? error.message : 'Erro inesperado no armazenamento ou sincronização.';
  }
}
