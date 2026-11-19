import { afterNextRender, Component, computed, inject, Injector, OnDestroy, signal } from '@angular/core';
import { AppState } from '../../core/app-state.service';
import type { TimeRecord } from '../../core/app-state.service';
import { PlantaoService } from '../../core/plantao.service';
import { AuthService } from '../../core/auth.service';
import type { OfflineOperation, SyncStatus } from '../../core/offline-sync.service';
import { LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideFileText, LucideClock3, LucidePrinter, LucideInfo } from '@lucide/angular';

interface ReportInterval {
  id: string;
  entry: TimeRecord | null;
  exit: TimeRecord | null;
  date: Date;
  durationMs: number | null;
}

interface ReportSyncState {
  status: SyncStatus;
  wasOffline: boolean;
}

@Component({ selector: 'app-reports', standalone: true, imports: [ LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideFileText, LucideClock3, LucidePrinter, LucideInfo ], templateUrl: './reports.html', styleUrl: './reports.scss' })
export class ReportsComponent implements OnDestroy {
  readonly vm = inject(AppState);
  private readonly plantaoService = inject(PlantaoService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly printObjectUrls = new Set<string>();
  private printCleanupTimer?: number;
  private printInProgress = false;
  readonly generatedAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
  readonly reportIntervals = computed<ReportInterval[]>(() => {
    const groups = new Map<string, { entry: TimeRecord | null; exit: TimeRecord | null }>();
    for (const record of this.vm.records()) {
      const attendanceId = record.attendanceId ?? String(record.id).replace(/-(entrada|saida)$/i, '');
      const group = groups.get(attendanceId) ?? { entry: null, exit: null };
      if (record.kind === 'Entrada') group.entry = record;
      else group.exit = record;
      groups.set(attendanceId, group);
    }

    const month = this.vm.selectedMonth();
    const year = this.vm.selectedYear();
    return [...groups.entries()]
      .map(([id, { entry, exit }]) => {
        const date = entry?.occurredAt ?? exit!.occurredAt;
        const durationMs = entry && exit && exit.occurredAt.getTime() > entry.occurredAt.getTime()
          ? exit.occurredAt.getTime() - entry.occurredAt.getTime()
          : null;
        return { id, entry, exit, date, durationMs };
      })
      .filter(interval => [interval.entry, interval.exit].some(record =>
        record?.occurredAt.getMonth() === month && record.occurredAt.getFullYear() === year))
      .sort((left, right) => left.date.getTime() - right.date.getTime());
  });

  readonly intervalTotalDiffers = computed(() => {
    const month = this.vm.selectedMonth();
    const year = this.vm.selectedYear();
    const individualTotal = this.reportIntervals().reduce((total, interval) => {
      if (!interval.entry || interval.durationMs === null) return total;
      const date = interval.entry.occurredAt;
      return date.getMonth() === month && date.getFullYear() === year ? total + interval.durationMs : total;
    }, 0);
    const match = this.vm.reportHours().match(/^(\d+)h\s+(\d+)min$/);
    if (!match) return false;
    const summaryTotal = Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000;
    const individualRoundedToMinute = Math.floor(individualTotal / 60_000) * 60_000;
    return individualRoundedToMinute !== summaryTotal;
  });
  readonly photoErrors = signal<ReadonlySet<string>>(new Set());
  readonly printPhotoUrls = signal<ReadonlyMap<string, string | null>>(new Map());
  readonly preparingPrint = signal(false);
  readonly printMessage = signal('');
  readonly printSyncStates = signal<ReadonlyMap<string, ReportSyncState>>(new Map());

  async printReport(withPhotos: boolean): Promise<void> {
    if (this.preparingPrint() || this.printInProgress) return;
    this.preparingPrint.set(true);
    this.printMessage.set('');
    this.photoErrors.set(new Set());
    const createdUrls = new Set<string>();
    let printStarted = false;

    try {
      const reportRecords = this.uniqueEventRecords();
      const operationMap = await this.readCurrentOperations(reportRecords);
      this.refreshPrintSyncStates(reportRecords, operationMap);
      if (withPhotos) {
        const photoRecords = this.uniquePhotoRecords();
        const isOnline = this.vm.offlineSync.online() && typeof navigator !== 'undefined' && navigator.onLine;
        const urls = await Promise.all(photoRecords.map(async record => {
          if (!record.photoPath) return [String(record.id), record.photoUrl ?? null] as const;
          const recordId = String(record.id);
          const operation = operationMap.get(recordId);
          if (operation?.photoBlob instanceof Blob && operation.photoBlob.size > 0) {
            const localUrl = URL.createObjectURL(operation.photoBlob);
            createdUrls.add(localUrl);
            this.printObjectUrls.add(localUrl);
            return [recordId, localUrl] as const;
          }

          if (!isOnline) return [recordId, null] as const;
          try {
            const remoteUrl = await this.plantaoService.getPhotoUrl(record.photoPath);
            return [recordId, remoteUrl ?? record.photoUrl ?? null] as const;
          } catch {
            return [recordId, record.photoUrl ?? null] as const;
          }
        }));
        this.printPhotoUrls.set(new Map(urls));
      } else {
        this.printPhotoUrls.set(new Map());
      }

      this.vm.includePhotosInPrint.set(withPhotos);
      await this.nextRender();

      if (withPhotos) {
        const images = Array.from(document.querySelectorAll<HTMLImageElement>(
          '.print-document.with-photos img[data-print-photo]',
        ));
        const loaded = await Promise.all(images.map(image => this.waitForImage(image)));
        images.forEach((image, index) => {
          if (!loaded[index] && image.dataset['recordId']) this.photoFailed(image.dataset['recordId']);
        });

        const unavailableCount = this.uniquePhotoRecords().filter(record =>
          !this.printPhotoUrl(record) || this.hasPhotoFailed(record),
        ).length;
        if (unavailableCount > 0) {
          this.printMessage.set(
            `${unavailableCount} fotografia(s) nao puderam ser carregadas. Elas serao identificadas como indisponiveis no relatorio.`,
          );
        }
        await this.nextRender();
      }

      this.preparingPrint.set(false);
      await this.nextRender();
      this.printInProgress = true;
      window.addEventListener('afterprint', this.handleAfterPrint, { once: true });
      this.printCleanupTimer = window.setTimeout(this.handleAfterPrint, 30 * 60_000);
      printStarted = true;
      window.print();
    } catch (error) {
      console.error('Falha ao preparar o relatorio para impressao:', error);
      this.printMessage.set('Nao foi possivel preparar o relatorio para impressao. Tente novamente.');
      if (printStarted) {
        this.handleAfterPrint();
        printStarted = false;
      }
    } finally {
      this.preparingPrint.set(false);
      if (!printStarted) {
        for (const url of createdUrls) {
          URL.revokeObjectURL(url);
          this.printObjectUrls.delete(url);
        }
        this.printPhotoUrls.set(new Map());
        this.vm.includePhotosInPrint.set(false);
      }
    }
  }

  private uniquePhotoRecords(): TimeRecord[] {
    const records = this.reportIntervals().flatMap(interval => this.photosFor(interval));
    const unique = new Map<string, TimeRecord>();
    for (const record of records) {
      const key = `${record.attendanceId ?? record.id}:${record.kind}:${record.photoPath ?? ''}`;
      if (!unique.has(key)) unique.set(key, record);
    }
    return [...unique.values()];
  }

  private uniqueEventRecords(): TimeRecord[] {
    const unique = new Map<string, TimeRecord>();
    for (const interval of this.reportIntervals()) {
      for (const record of [interval.entry, interval.exit]) {
        if (record) unique.set(String(record.id), record);
      }
    }
    return [...unique.values()];
  }

  private async readCurrentOperations(records: TimeRecord[]): Promise<Map<string, OfflineOperation | null>> {
    const operations = new Map<string, OfflineOperation | null>();
    const cached = this.vm.offlineSync.operations();
    for (const record of records) {
      const key = String(record.id);
      const userId = this.auth.currentUserId() ?? cached.find(operation => operation.id === record.localOperationId)?.userId ?? null;
      if (!userId || !record.photoPath || !record.plantaoId) {
        operations.set(key, null);
        continue;
      }
      try {
        operations.set(key, await this.vm.offlineSync.findOperationForRecord(userId, {
          operationId: record.localOperationId,
          plantaoId: record.plantaoId,
          kind: record.kind,
          attendanceId: record.attendanceId,
          photoPath: record.photoPath,
        }));
      } catch (error) {
        console.warn('[reports] Could not read local sync status; preserving the record fallback state.', error);
        operations.set(key, null);
      }
    }
    return operations;
  }

  private refreshPrintSyncStates(
    records: TimeRecord[],
    operations: Map<string, OfflineOperation | null>,
  ): void {
    const states = new Map<string, ReportSyncState>();
    for (const record of records) {
      const key = String(record.id);
      const operation = operations.get(key);
      if (operation) {
        states.set(key, { status: operation.status, wasOffline: operation.wasOffline });
      } else if (/^\d+-(entrada|saida)$/i.test(key)) {
        states.set(key, { status: 'synced', wasOffline: false });
      } else {
        states.set(key, { status: record.syncStatus ?? 'pending', wasOffline: record.wasOffline ?? true });
      }
    }
    this.printSyncStates.set(states);
  }

  syncStatusLabel(record: TimeRecord): string {
    const state = this.printSyncStates().get(String(record.id)) ?? {
      status: record.syncStatus ?? 'pending',
      wasOffline: record.wasOffline ?? true,
    };
    if (state.status === 'synced') return state.wasOffline ? 'Registrado offline · Sincronizado' : 'Sincronizado';
    if (state.status === 'syncing') return 'Sincronizando';
    if (state.status === 'failed') return 'Falha na sincronização';
    return 'Pendente de sincronização';
  }

  private readonly handleAfterPrint = (): void => {
    window.removeEventListener('afterprint', this.handleAfterPrint);
    if (this.printCleanupTimer !== undefined) window.clearTimeout(this.printCleanupTimer);
    this.printCleanupTimer = undefined;
    for (const url of this.printObjectUrls) URL.revokeObjectURL(url);
    this.printObjectUrls.clear();
    this.printPhotoUrls.set(new Map());
    this.photoErrors.set(new Set());
    this.vm.includePhotosInPrint.set(false);
    this.printInProgress = false;
  };

  ngOnDestroy(): void {
    window.removeEventListener('afterprint', this.handleAfterPrint);
    if (this.printCleanupTimer !== undefined) window.clearTimeout(this.printCleanupTimer);
    for (const url of this.printObjectUrls) URL.revokeObjectURL(url);
    this.printObjectUrls.clear();
  }

  printPhotoUrl(record: TimeRecord): string | null {
    const urls = this.printPhotoUrls();
    const id = String(record.id);
    return urls.has(id) ? urls.get(id) ?? null : record.photoUrl ?? null;
  }

  private nextRender(): Promise<void> {
    return new Promise(resolve => afterNextRender(() => resolve(), { injector: this.injector }));
  }

  private async waitForImage(image: HTMLImageElement): Promise<boolean> {
    if (!image.complete) {
      const finished = await new Promise<boolean>(resolve => {
        const timeout = window.setTimeout(() => finish(false), 20_000);
        const finish = (loaded: boolean): void => {
          window.clearTimeout(timeout);
          image.removeEventListener('load', onLoad);
          image.removeEventListener('error', onError);
          resolve(loaded);
        };
        const onLoad = (): void => finish(true);
        const onError = (): void => finish(false);
        image.addEventListener('load', onLoad, { once: true });
        image.addEventListener('error', onError, { once: true });
        if (image.complete) finish(image.naturalWidth > 0);
      });
      if (!finished) return false;
    }
    if (image.naturalWidth === 0) return false;
    try {
      await image.decode();
      return image.naturalWidth > 0;
    } catch {
      return false;
    }
  }

  photoFailed(recordId: string | number): void {
    const next = new Set(this.photoErrors());
    next.add(String(recordId));
    this.photoErrors.set(next);
  }

  hasPhotoFailed(record: TimeRecord): boolean {
    return this.photoErrors().has(String(record.id));
  }

  formatDuration(durationMs: number | null): string {
    if (durationMs === null || durationMs < 0) return '—';
    const hours = Math.floor(durationMs / 3_600_000);
    const minutes = Math.floor((durationMs % 3_600_000) / 60_000);
    return `${hours === 0 ? '00' : hours}h${String(minutes).padStart(2, '0')}min`;
  }

  photosFor(interval: ReportInterval): TimeRecord[] {
    return [interval.entry, interval.exit].filter((record): record is TimeRecord => Boolean(record));
  }
}
