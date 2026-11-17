import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppState } from '../../core/app-state.service';
import { FieldErrorComponent } from '../../shared/field-error/field-error';
import { LucideUserRound, LucideFileText, LucideBuilding, LucideCheck } from '@lucide/angular';
@Component({ selector: 'app-profile', standalone: true, imports: [FormsModule, FieldErrorComponent, LucideUserRound, LucideFileText, LucideBuilding, LucideCheck], templateUrl: './profile.html', styleUrl: './profile.scss' })
export class ProfileComponent { readonly vm = inject(AppState); }
