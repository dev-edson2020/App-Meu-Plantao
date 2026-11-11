import { Component, computed, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AppHeaderComponent } from './shared/app-header/app-header';
import {
  LucideArrowRight,
  LucideArrowRightToLine,
  LucideArrowLeftToLine,
  LucideBuilding,
  LucideCalendarDays,
  LucideCamera,
  LucideChartNoAxesColumnIncreasing,
  LucideCheck,
  LucideChevronLeft,
  LucideChevronRight,
  LucideClock3,
  LucideFileText,
  LucideHouse,
  LucideImage,
  LucideListChecks,
  LucideLockKeyhole,
  LucideLogIn,
  LucideLogOut,
  LucideMail,
  LucidePencil,
  LucidePrinter,
  LucideUserRound,
  LucideX,
} from '@lucide/angular';

type Screen = 'welcome' | 'home' | 'register' | 'records' | 'reports' | 'profile';
type RecordKind = 'Entrada' | 'Saída';

interface TimeRecord {
  id: number;
  kind: RecordKind;
  occurredAt: Date;
  reason: string;
  photoName: string;
}

@Component({
  selector: 'app-root',
  imports: [
    FormsModule,
    DatePipe,
    RouterOutlet,
    AppHeaderComponent,
    LucideArrowRight,
    LucideArrowRightToLine,
    LucideArrowLeftToLine,
    LucideBuilding,
    LucideCalendarDays,
    LucideCamera,
    LucideChartNoAxesColumnIncreasing,
    LucideCheck,
    LucideChevronLeft,
    LucideChevronRight,
    LucideClock3,
    LucideFileText,
    LucideHouse,
    LucideImage,
    LucideListChecks,
    LucideLockKeyhole,
    LucideLogIn,
    LucideLogOut,
    LucideMail,
    LucidePencil,
    LucidePrinter,
    LucideUserRound,
    LucideX,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly screen = signal<Screen>('welcome');
  protected readonly showExitConfirmation = signal(false);
  private readonly previousScreen = signal<Screen>('welcome');
  protected readonly authMode = signal<'login' | 'signup'>('login');
  protected readonly signupStep = signal(0);
  protected readonly recordKind = signal<RecordKind>('Entrada');
  protected readonly records = signal<TimeRecord[]>([]);
  protected readonly notice = signal('');
  protected readonly now = new Date();
  protected dateValue = this.inputDate(this.now);
  protected timeValue = this.inputTime(this.now);
  protected reasonValue = '';
  protected photoName = '';
  protected photoPreviewUrl = '';
  protected profileName = '';
  protected crtrValue = '';
  protected crtrRegionValue = '';
  protected workplaceValue = 'Irmandade Santa Casa de Angatuba';
  protected loginEmail = '';
  protected loginPassword = '';
  protected confirmPassword = '';
  protected readonly selectedMonth = signal(this.now.getMonth());
  protected readonly selectedYear = signal(this.now.getFullYear());
  protected readonly crtrDisplay = computed(() => [this.crtrValue, this.crtrRegionValue].filter(Boolean).join(' · ') || 'CRTR não informado');

  constructor(private readonly router: Router) {
    this.screen.set(this.screenFromUrl(this.router.url));
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const nextScreen = this.screenFromUrl(event.urlAfterRedirects);
        if (this.screen() !== nextScreen) {
          this.previousScreen.set(this.screen());
          this.screen.set(nextScreen);
        }
      });
  }

  protected readonly monthLabel = computed(() =>
    new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
      .format(new Date(this.selectedYear(), this.selectedMonth(), 1))
      .replace(/^./, (letter) => letter.toLocaleUpperCase('pt-BR')),
  );

  protected readonly visibleRecords = computed(() =>
    this.records()
      .filter((record) => record.occurredAt.getMonth() === this.selectedMonth() && record.occurredAt.getFullYear() === this.selectedYear())
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
  );

  protected readonly recordCount = computed(() => this.visibleRecords().length);

  protected readonly reportHours = computed(() => {
    const events = this.visibleRecords().slice().sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const intervals: Array<[number, number]> = [];
    let open: number | null = null;
    for (const event of events) {
      if (event.kind === 'Entrada' && open === null) open = event.occurredAt.getTime();
      else if (event.kind === 'Saída' && open !== null && event.occurredAt.getTime() > open) {
        intervals.push([open, event.occurredAt.getTime()]);
        open = null;
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let current: [number, number] | null = null;
    for (const interval of intervals) {
      if (!current || interval[0] > current[1]) {
        if (current) total += current[1] - current[0];
        current = [...interval];
      } else current[1] = Math.max(current[1], interval[1]);
    }
    if (current) total += current[1] - current[0];
    return `${Math.floor(total / 3_600_000)}h ${String(Math.floor((total % 3_600_000) / 60_000)).padStart(2, '0')}min`;
  });

  protected go(screen: Screen): void {
    this.notice.set('');
    void this.router.navigateByUrl(this.urlForScreen(screen));
  }

  protected goBack(): void {
    const previous = this.previousScreen();
    this.go(previous === 'welcome' ? 'home' : previous);
  }

  protected requestExit(): void {
    this.showExitConfirmation.set(true);
  }

  protected cancelExit(): void {
    this.showExitConfirmation.set(false);
  }

  protected confirmExit(): void {
    this.showExitConfirmation.set(false);
    this.loginEmail = '';
    this.loginPassword = '';
    this.confirmPassword = '';
    this.authMode.set('login');
    this.signupStep.set(0);
    this.go('welcome');
    void this.signOutCurrentSession();
  }

  private async signOutCurrentSession(): Promise<void> {
    try {
      const { supabase } = await import('./core/supabase-client');
      if (supabase) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) {
          this.notice.set('Não foi possível encerrar a sessão. Tente novamente.');
          return;
        }
      }
    } catch {
      this.notice.set('Não foi possível encerrar a sessão. Tente novamente.');
      return;
    }
  }

  private urlForScreen(screen: Screen): string {
    const paths: Record<Screen, string> = {
      welcome: '/login',
      home: '/dashboard',
      register: '/register',
      records: '/records',
      reports: '/reports',
      profile: '/profile',
    };
    return paths[screen];
  }

  private screenFromUrl(url: string): Screen {
    const path = url.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
    const screens: Record<string, Screen> = {
      login: 'welcome',
      dashboard: 'home',
      register: 'register',
      records: 'records',
      reports: 'reports',
      profile: 'profile',
    };
    return screens[path] ?? 'welcome';
  }

  protected changeMonth(offset: number): void {
    const next = new Date(this.selectedYear(), this.selectedMonth() + offset, 1);
    this.selectedMonth.set(next.getMonth());
    this.selectedYear.set(next.getFullYear());
  }

  protected handlePhoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
    this.photoName = file.name;
    this.photoPreviewUrl = URL.createObjectURL(file);
  }

  protected clearPhoto(cameraInput: HTMLInputElement, galleryInput: HTMLInputElement): void {
    if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
    this.photoName = '';
    this.photoPreviewUrl = '';
    cameraInput.value = '';
    galleryInput.value = '';
  }

  protected saveRecord(): void {
    if (!this.dateValue || !this.timeValue) {
      this.notice.set('Informe a data e o horário do registro.');
      return;
    }
    const occurredAt = new Date(`${this.dateValue}T${this.timeValue}:00`);
    this.records.update((items) => [
      ...items,
      { id: Date.now(), kind: this.recordKind(), occurredAt, reason: this.reasonValue.trim(), photoName: this.photoName },
    ]);
    this.selectedMonth.set(occurredAt.getMonth());
    this.selectedYear.set(occurredAt.getFullYear());
    this.notice.set('Registro adicionado nesta sessão. A sincronização com sua conta será conectada na próxima etapa.');
    this.reasonValue = '';
    this.photoName = '';
    if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
    this.photoPreviewUrl = '';
  }

  protected saveProfile(): void {
    this.notice.set('Alterações mantidas nesta sessão. A sincronização com sua conta será conectada na próxima etapa.');
  }

  protected submitAuth(): void {
    if (this.authMode() === 'signup') {
      if (this.signupStep() === 0) {
        this.signupStep.set(1);
        return;
      }
      this.notice.set('Cadastro ainda não conectado. Nenhuma conta ou dado foi enviado.');
      return;
    }
    this.go('home');
  }

  protected toggleAuthMode(): void {
    this.authMode.update((mode) => mode === 'login' ? 'signup' : 'login');
    this.signupStep.set(0);
    this.notice.set('');
  }

  protected recoverPassword(): void {
    this.notice.set(this.loginEmail.trim()
      ? 'A recuperação de senha será habilitada quando a autenticação for conectada.'
      : 'Informe seu e-mail acima para solicitar a recuperação de senha.');
  }

  protected previousSignupStep(): void {
    this.signupStep.set(0);
    this.notice.set('');
  }

  protected printReport(): void {
    if (this.visibleRecords().length) window.print();
  }

  protected formatDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' })
      .format(date).replace('.', '');
  }

  protected formatTime(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(date);
  }

  private inputDate(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private inputTime(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date);
  }
}
