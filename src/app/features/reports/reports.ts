import { afterNextRender, Component, computed, inject, Injector, signal } from '@angular/core';
import { AppState } from '../../core/app-state.service';
import type { TimeRecord } from '../../core/app-state.service';
import { PlantaoService } from '../../core/plantao.service';
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
  private readonly plantaoService = inject(PlantaoService);
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
  readonly printPhotoUrls = signal<ReadonlyMap<string, string | null>>(new Map());
  readonly preparingPrint = signal(false);
  readonly printMessage = signal('');

  async printReport(withPhotos: boolean): Promise<void> {
    if (this.preparingPrint()) return;
    this.preparingPrint.set(true);
    this.printMessage.set('');
    this.photoErrors.set(new Set());

    if (withPhotos) {
      const reportRecords = this.reportIntervals().flatMap(interval => this.photosFor(interval));
      const urls = await Promise.all(reportRecords.map(async record => {
        if (!record.photoPath) return [String(record.id), record.photoUrl ?? null] as const;
        try {
          return [String(record.id), await this.plantaoService.getPhotoUrl(record.photoPath)] as const;
        } catch {
          return [String(record.id), null] as const;
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

      const reportRecords = this.reportIntervals().flatMap(interval => this.photosFor(interval));
      const unavailableCount = reportRecords.filter(record =>
        !this.printPhotoUrl(record) || this.hasPhotoFailed(record),
      ).length;
      if (unavailableCount > 0) {
        this.printMessage.set(
          `${unavailableCount} fotografia(s) não puderam ser carregadas. Elas serão identificadas como indisponíveis no relatório.`,
        );
      }
      await this.nextRender();
    }

    this.preparingPrint.set(false);
    await this.nextRender();
    window.print();
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
