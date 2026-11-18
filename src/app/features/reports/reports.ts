import { afterNextRender, Component, computed, inject, Injector, signal } from '@angular/core';
import { AppState } from '../../core/app-state.service';
import type { TimeRecord } from '../../core/app-state.service';
import { LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideFileText, LucideClock3, LucidePrinter } from '@lucide/angular';

interface ReportInterval {
  id: string;
  entry: TimeRecord | null;
  exit: TimeRecord | null;
  date: Date;
  durationMs: number | null;
}

@Component({ selector: 'app-reports', standalone: true, imports: [ LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideFileText, LucideClock3, LucidePrinter ], templateUrl: './reports.html', styleUrl: './reports.scss' })
export class ReportsComponent {
  readonly vm = inject(AppState);
  private readonly injector = inject(Injector);
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

  printReport(withPhotos: boolean): void {
    this.vm.includePhotosInPrint.set(withPhotos);
    afterNextRender(() => window.print(), { injector: this.injector });
  }

  photoFailed(record: TimeRecord): void {
    const next = new Set(this.photoErrors());
    next.add(String(record.id));
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
