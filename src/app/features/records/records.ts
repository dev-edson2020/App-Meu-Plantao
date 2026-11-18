import { Component, computed, inject, signal } from '@angular/core';
import { AppState } from '../../core/app-state.service';
import type { TimeRecord } from '../../core/app-state.service';
import type { OfflineOperation } from '../../core/offline-sync.service';
import { DatePipe } from '@angular/common';
import { LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideCheck, LucideClock3, LucideImage, LucideX } from '@lucide/angular';
const APP_MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: 'numeric',
});

@Component({ selector: 'app-records', standalone: true, imports: [DatePipe, LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideCheck, LucideClock3, LucideImage, LucideX], templateUrl: './records.html', styleUrl: './records.scss' })
export class RecordsComponent {
  readonly vm = inject(AppState);
  readonly selectedMonthIsPast = computed(() => {
    const currentParts = APP_MONTH_FORMATTER.formatToParts(this.vm.clockNow());
    const currentYear = Number(currentParts.find(part => part.type === 'year')?.value);
    const currentMonth = Number(currentParts.find(part => part.type === 'month')?.value) - 1;
    const selectedMonthIndex = this.vm.selectedYear() * 12 + this.vm.selectedMonth();
    const currentMonthIndex = currentYear * 12 + currentMonth;
    return selectedMonthIndex < currentMonthIndex;
  });
  readonly selectedRecord = signal<TimeRecord | null>(null);
  readonly selectedOperation = computed(() => {
    const operationId = this.selectedRecord()?.localOperationId;
    return operationId ? this.vm.offlineSync.operations().find(operation => operation.id === operationId) ?? null : null;
  });
  readonly photoLoadFailed = signal(false);
  readonly operationLoading = signal(false);
  readonly operationLookupFailed = signal(false);
  readonly syncActionMessage = signal('');

  async openDetails(record: TimeRecord): Promise<void> {
    this.photoLoadFailed.set(false);
    this.operationLookupFailed.set(false);
    this.syncActionMessage.set('');
    this.selectedRecord.set(record);
    if (!record.localOperationId) return;
    const userId = this.vm.auth.currentUserId();
    if (!userId) { this.operationLookupFailed.set(true); return; }
    this.operationLoading.set(true);
    try {
      await this.vm.offlineSync.refresh(userId);
      const operation = this.selectedOperation();
      if (!operation) this.operationLookupFailed.set(true);
      else if (operation.syncError) {
        console.info('[offline-sync] erro persistido carregado do IndexedDB', {
          operationId: operation.id,
          localAttendanceId: operation.localAttendanceId,
          remoteAttendanceId: operation.remoteAttendanceId ?? null,
          status: operation.status,
          retryCount: operation.retryCount,
          lastAttemptAt: operation.lastAttemptAt ?? null,
          syncError: operation.syncError,
        });
      }
    } catch {
      this.operationLookupFailed.set(true);
    } finally {
      this.operationLoading.set(false);
    }
  }

  async syncSelectedOperation(): Promise<void> {
    const record = this.selectedRecord();
    const operation = this.selectedOperation();
    const userId = this.vm.auth.currentUserId();
    if (!record?.localOperationId || !operation || !userId || operation.status === 'synced' || operation.status === 'syncing') return;
    this.syncActionMessage.set('');
    const result = await this.vm.offlineSync.syncNow(userId, operation.id, true);
    if (result === 'pending') {
      const blocker = await this.vm.offlineSync.getBlockingOperation(userId, operation.id);
      this.syncActionMessage.set(blocker
        ? `Aguardando o registro anterior deste plantão${blocker.syncError ? `: ${blocker.syncError}` : '.'}`
        : 'A operação permanece pendente e poderá ser tentada novamente.');
    }
  }

  getOperationStatusLabel(operation: OfflineOperation): string {
    switch (operation.status) {
      case 'syncing': return 'Sincronizando';
      case 'synced': return 'Sincronizado';
      case 'failed': return 'Falha na sincronização';
      default: return 'Pendente de sincronização';
    }
  }

  closeDetails(): void {
    this.selectedRecord.set(null);
    this.photoLoadFailed.set(false);
    this.operationLoading.set(false);
    this.operationLookupFailed.set(false);
    this.syncActionMessage.set('');
  }
}
