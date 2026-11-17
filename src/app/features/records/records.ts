import { Component, inject, signal } from '@angular/core';
import { AppState } from '../../core/app-state.service';
import type { TimeRecord } from '../../core/app-state.service';
import { DatePipe } from '@angular/common';
import { LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideCheck, LucideClock3, LucideImage, LucideX } from '@lucide/angular';
@Component({ selector: 'app-records', standalone: true, imports: [DatePipe, LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideCheck, LucideClock3, LucideImage, LucideX], templateUrl: './records.html', styleUrl: './records.scss' })
export class RecordsComponent {
  readonly vm = inject(AppState);
  readonly selectedRecord = signal<TimeRecord | null>(null);
  readonly photoLoadFailed = signal(false);

  openDetails(record: TimeRecord): void {
    this.photoLoadFailed.set(false);
    this.selectedRecord.set(record);
  }

  closeDetails(): void {
    this.selectedRecord.set(null);
    this.photoLoadFailed.set(false);
  }
}
