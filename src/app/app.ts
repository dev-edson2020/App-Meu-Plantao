import { Component, inject } from '@angular/core';
import { AppState } from './core/app-state.service';
import { AuthService } from './core/auth.service';
import { AppHeaderComponent } from './shared/app-header/app-header';
import { ToastComponent } from './shared/toast/toast';
import { LoginComponent } from './features/auth/login/login';
import { SignupComponent } from './features/auth/signup/signup';
import { PasswordRecoveryComponent } from './features/auth/password-recovery/password-recovery';
import { HomeComponent } from './features/home/home';
import { RegisterComponent } from './features/register/register';
import { RecordsComponent } from './features/records/records';
import { ReportsComponent } from './features/reports/reports';
import { ProfileComponent } from './features/profile/profile';
import {
  LucideHouse,
  LucideClock3,
  LucideChartNoAxesColumnIncreasing,
  LucideUserRound,
} from '@lucide/angular';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    AppHeaderComponent,
    ToastComponent,
    LoginComponent,
    SignupComponent,
    PasswordRecoveryComponent,
    HomeComponent,
    RegisterComponent,
    RecordsComponent,
    ReportsComponent,
    ProfileComponent,
    LucideHouse,
    LucideClock3,
    LucideChartNoAxesColumnIncreasing,
    LucideUserRound,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly vm = inject(AppState);
  readonly auth = inject(AuthService);
}
