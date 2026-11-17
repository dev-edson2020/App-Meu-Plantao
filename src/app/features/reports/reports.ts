import { afterNextRender, Component, computed, inject, Injector, signal } from '@angular/core';
import { AppState } from '../../core/app-state.service';
import type { TimeRecord } from '../../core/app-state.service';
import { LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideFileText, LucideClock3, LucidePrinter } from '@lucide/angular';
@Component({ selector: 'app-reports', standalone: true, imports: [ LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideFileText, LucideClock3, LucidePrinter ], templateUrl: './reports.html', styleUrl: './reports.scss' })
export class ReportsComponent {
  readonly vm = inject(AppState);
  private readonly injector = inject(Injector);
  readonly generatedAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
  readonly chronologicalRecords = computed(() =>
    this.vm.visibleRecords().slice().sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime()),
  );
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
}
