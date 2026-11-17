import { Component, inject } from '@angular/core';
import { AppState } from '../../core/app-state.service';
import { LucideArrowRight, LucideCalendarDays, LucideCamera, LucideChartNoAxesColumnIncreasing, LucideListChecks, LucideUserRound } from '@lucide/angular';
@Component({ selector: 'app-home', standalone: true, imports: [ LucideArrowRight, LucideCalendarDays, LucideCamera, LucideChartNoAxesColumnIncreasing, LucideListChecks, LucideUserRound ], templateUrl: './home.html', styleUrl: './home.scss' })
export class HomeComponent { readonly vm = inject(AppState); }
