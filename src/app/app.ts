
import { ChangeDetectorRef, Component, computed, signal, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { supabase } from './core/supabase-client';
import { PlantaoService } from './core/plantao.service';
import type { Plantao, Atendimento } from './core/plantao.service';
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
export class App implements OnDestroy {
  protected readonly screen = signal<Screen>('welcome');
  protected readonly showExitConfirmation = signal(false);
  private readonly previousScreen = signal<Screen>('welcome');
  protected readonly authMode = signal<'login' | 'signup'>('login');
  protected readonly isPasswordRecovery = signal(false);
  protected newPassword = '';
  protected confirmNewPassword = '';
  protected readonly signupStep = signal(0);
  protected readonly recordKind = signal<RecordKind>('Entrada');
  protected readonly records = signal<TimeRecord[]>([]);
  protected readonly activePlantao = signal<Plantao | null>(null);
  protected readonly activeAtendimento = signal<Atendimento | null>(null);
  protected readonly notice = signal('');

  protected readonly clockNow = signal(new Date());
  protected readonly capturedAt = signal<Date | null>(null);
  private clockTimer: ReturnType<typeof setInterval> | undefined;

  protected readonly now = new Date();
  protected reasonValue = '';
  protected photoName = '';
  protected selectedPhoto: File | null = null;
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

  protected readonly crtrDisplay = computed(
    () =>
      [this.crtrValue, this.crtrRegionValue].filter(Boolean).join(' · ') || 'CRTR não informado',
  );

  constructor(
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    private readonly plantaoService: PlantaoService,
  ) {
    this.screen.set(this.screenFromUrl(this.router.url));

    this.clockTimer = setInterval(() => {
      this.clockNow.set(new Date());
      this.cdr.detectChanges();
    }, 1000);

    supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        this.isPasswordRecovery.set(true);
        this.screen.set('welcome');
        this.notice.set('Digite sua nova senha.');
        return;
      }

      if (event === 'SIGNED_IN' && session) {
        void this.loadProfile(session.user.id);
        void this.loadActivePlantao();
      }

      if (event === 'INITIAL_SESSION' && session) {
        void this.loadProfile(session.user.id);
        void this.loadActivePlantao();
      }

      if (event === 'SIGNED_OUT') {
        this.profileName = '';
        this.crtrValue = '';
        this.crtrRegionValue = '';
        this.workplaceValue = '';
        this.activePlantao.set(null);
        this.activeAtendimento.set(null);
      }
    });

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

  protected captureRecordKind(kind: RecordKind): void {
    this.recordKind.set(kind);
    this.capturedAt.set(new Date());
  }

  ngOnDestroy(): void {
    if (this.clockTimer !== undefined) {
      clearInterval(this.clockTimer);
    }
  }

  protected readonly monthLabel = computed(() =>
    new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    })
      .format(new Date(this.selectedYear(), this.selectedMonth(), 1))
      .replace(/^./, (letter) => letter.toLocaleUpperCase('pt-BR')),
  );

  protected readonly visibleRecords = computed(() =>
    this.records()
      .filter(
        (record) =>
          record.occurredAt.getMonth() === this.selectedMonth() &&
          record.occurredAt.getFullYear() === this.selectedYear(),
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
  );

  protected readonly recordCount = computed(() => this.visibleRecords().length);

  protected readonly reportHours = computed(() => {
    const events = this.visibleRecords()
      .slice()
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const intervals: Array<[number, number]> = [];
    let open: number | null = null;

    for (const event of events) {
      if (event.kind === 'Entrada' && open === null) {
        open = event.occurredAt.getTime();
      } else if (
        event.kind === 'Saída' &&
        open !== null &&
        event.occurredAt.getTime() > open
      ) {
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
      } else {
        current[1] = Math.max(current[1], interval[1]);
      }
    }

    if (current) total += current[1] - current[0];

    return `${Math.floor(total / 3_600_000)}h ${String(
      Math.floor((total % 3_600_000) / 60_000),
    ).padStart(2, '0')}min`;
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

    if (this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
    }

    this.selectedPhoto = file;
    this.photoName = file.name;
    this.photoPreviewUrl = URL.createObjectURL(file);
  }

  protected clearPhoto(
    cameraInput: HTMLInputElement,
    galleryInput: HTMLInputElement,
  ): void {
    if (this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
    }

    this.selectedPhoto = null;
    this.photoName = '';
    this.photoPreviewUrl = '';
    cameraInput.value = '';
    galleryInput.value = '';
  }

  protected async saveRecord(): Promise<void> {
    const occurredAt = this.capturedAt();

    if (!occurredAt) {
      this.notice.set('Selecione Entrada ou Saída para capturar o horário.');
      return;
    }

    if (!this.selectedPhoto) {
      this.notice.set('Adicione uma foto para continuar.');
      return;
    }

    const kind = this.recordKind();
    const reason = this.reasonValue.trim();

    try {
      if (kind === 'Entrada') {
        if (this.activeAtendimento()) {
          this.notice.set('Já existe um atendimento em andamento. Registre a Saída primeiro.');
          return;
        }

        const plantao = await this.plantaoService.startPlantao(
          occurredAt.toISOString(),
        );

        this.activePlantao.set(plantao);

        const photoPath = await this.plantaoService.uploadPhoto(
          this.selectedPhoto,
          plantao.id,
        );

        const atendimento = await this.plantaoService.startAtendimento(
          plantao.id,
          occurredAt.toISOString(),
          photoPath,
          reason || null,
        );

        this.activeAtendimento.set(atendimento);
      } else {
        const plantao = this.activePlantao();
        const atendimentoAtual = this.activeAtendimento();

        if (!plantao || !atendimentoAtual) {
          this.notice.set('Não existe atendimento aberto para registrar a Saída.');
          return;
        }

        const dataHoraEntrada = new Date(
          atendimentoAtual.data_hora_entrada,
        );

        if (occurredAt.getTime() <= dataHoraEntrada.getTime()) {
          this.notice.set('A Saída deve ter horário posterior à Entrada.');
          return;
        }

        const photoPath = await this.plantaoService.uploadPhoto(
          this.selectedPhoto,
          plantao.id,
        );

        await this.plantaoService.finishAtendimento(
          atendimentoAtual.id,
          occurredAt.toISOString(),
          photoPath,
          reason || null,
        );

        this.activeAtendimento.set(null);
      }

      this.records.update((items) => [
        ...items,
        {
          id: Date.now(),
          kind,
          occurredAt,
          reason,
          photoName: this.photoName,
        },
      ]);

      this.selectedMonth.set(occurredAt.getMonth());
      this.selectedYear.set(occurredAt.getFullYear());

      this.notice.set(
        kind === 'Entrada'
          ? 'Entrada registrada com sucesso!'
          : 'Saída registrada com sucesso!',
      );

      this.reasonValue = '';
      this.selectedPhoto = null;
      this.photoName = '';
      this.capturedAt.set(null);

      if (this.photoPreviewUrl) {
        URL.revokeObjectURL(this.photoPreviewUrl);
      }

      this.photoPreviewUrl = '';
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Erro ao salvar registro:', error);
      this.notice.set(
        'Não foi possível salvar o registro. Verifique sua conexão e tente novamente.',
      );
      this.cdr.detectChanges();
    }
  }

  private async loadProfile(userId: string): Promise<void> {
    if (!supabase) return;

    const { data, error } = await supabase
      .from('perfis')
      .select('nome_completo, numero_crtr, local_trabalho')
      .eq('id', userId)
      .single();

    if (error) {
      this.notice.set('Não foi possível carregar seus dados profissionais.');
      return;
    }

    this.profileName = data.nome_completo ?? '';
    this.crtrValue = data.numero_crtr ?? '';
    this.crtrRegionValue = '';
    this.workplaceValue = data.local_trabalho ?? '';

    this.cdr.detectChanges();
  }

  private async loadActivePlantao(): Promise<void> {
    try {
      const plantao = await this.plantaoService.getOpenPlantao();
      this.activePlantao.set(plantao);

      if (plantao) {
        const atendimento = await this.plantaoService.getOpenAtendimento(plantao.id);
        this.activeAtendimento.set(atendimento);
      } else {
        this.activeAtendimento.set(null);
      }

      this.cdr.detectChanges();
    } catch {
      this.notice.set('Não foi possível carregar o plantão em andamento.');
      this.cdr.detectChanges();
    }
  }

  protected async saveProfile(): Promise<void> {
    if (!supabase) {
      this.notice.set('Não foi possível conectar ao servidor.');
      this.cdr.detectChanges();
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      this.notice.set('Sua sessão expirou. Entre novamente.');
      this.cdr.detectChanges();
      return;
    }

    if (
      !this.profileName.trim() ||
      !this.crtrValue.trim() ||
      !this.workplaceValue.trim()
    ) {
      this.notice.set('Preencha todos os campos.');
      this.cdr.detectChanges();
      return;
    }

    const { error } = await supabase
      .from('perfis')
      .update({
        nome_completo: this.profileName.trim(),
        numero_crtr: this.crtrValue.trim(),
        local_trabalho: this.workplaceValue.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userData.user.id);

    if (error) {
      this.notice.set('Não foi possível salvar as alterações.');
      this.cdr.detectChanges();
      return;
    }

    this.notice.set('Cadastro atualizado com sucesso!');
    this.cdr.detectChanges();
  }

  protected async submitAuth(): Promise<void> {
    if (!supabase) {
      this.notice.set('Não foi possível conectar ao servidor.');
      return;
    }

    if (this.isPasswordRecovery()) {
      if (!this.newPassword || !this.confirmNewPassword) {
        this.notice.set('Preencha os dois campos de senha.');
        return;
      }

      if (this.newPassword.length < 6) {
        this.notice.set('A senha deve ter pelo menos 6 caracteres.');
        return;
      }

      if (this.newPassword !== this.confirmNewPassword) {
        this.notice.set('As senhas não são iguais.');
        return;
      }

      this.notice.set('Atualizando sua senha...');

      try {
        const { error } = await supabase.auth.updateUser({
          password: this.newPassword,
        });

        if (error) {
          this.notice.set('Não foi possível atualizar a senha. Tente novamente.');
          return;
        }

        await supabase.auth.signOut({ scope: 'local' });

        this.isPasswordRecovery.set(false);
        this.newPassword = '';
        this.confirmNewPassword = '';
        this.loginPassword = '';
        this.authMode.set('login');

        this.notice.set('Senha alterada com sucesso! Entre com sua nova senha.');
      } catch {
        this.notice.set('Erro ao atualizar a senha. Tente novamente.');
      }

      return;
    }

    if (this.authMode() === 'signup') {
      if (this.signupStep() === 0) {
        if (!this.loginEmail.trim() || !this.loginPassword || !this.confirmPassword) {
          this.notice.set('Preencha todos os campos.');
          return;
        }

        if (this.loginPassword.length < 6) {
          this.notice.set('A senha deve ter pelo menos 6 caracteres.');
          return;
        }

        if (this.loginPassword !== this.confirmPassword) {
          this.notice.set('As senhas não são iguais.');
          return;
        }

        this.notice.set('');
        this.signupStep.set(1);
        return;
      }

      if (
        !this.profileName.trim() ||
        !this.crtrValue.trim() ||
        !this.workplaceValue.trim()
      ) {
        this.notice.set('Preencha todos os dados profissionais.');
        return;
      }

      this.notice.set('Criando sua conta...');

      try {
        const { data, error } = await supabase.auth.signUp({
          email: this.loginEmail.trim(),
          password: this.loginPassword,
        });

        if (error) {
          this.notice.set(error.message);
          return;
        }

        if (!data.user || !data.session) {
          this.notice.set('Conta criada, mas não foi possível iniciar a sessão.');
          return;
        }

        const { error: profileError } = await supabase.from('perfis').insert({
          id: data.user.id,
          nome_completo: this.profileName.trim(),
          numero_crtr: this.crtrValue.trim(),
          local_trabalho: this.workplaceValue.trim(),
        });

        if (profileError) {
          this.notice.set(
            'Conta criada, mas houve um erro ao salvar o perfil: ' + profileError.message,
          );
          return;
        }

        this.notice.set('');
        this.go('home');
      } catch {
        this.notice.set('Erro ao criar a conta. Tente novamente.');
      }

      return;
    }

    if (!this.loginEmail.trim() || !this.loginPassword) {
      this.notice.set('Informe seu e-mail e sua senha.');
      return;
    }

    this.notice.set('Entrando...');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: this.loginEmail.trim(),
        password: this.loginPassword,
      });

      if (error) {
        this.notice.set('E-mail ou senha inválidos.');
        return;
      }

      this.notice.set('');
      this.go('home');
    } catch {
      this.notice.set('Erro ao conectar. Tente novamente.');
    }
  }

  protected toggleAuthMode(): void {
    this.authMode.update((mode) => (mode === 'login' ? 'signup' : 'login'));
    this.signupStep.set(0);
    this.notice.set('');
  }

  protected async recoverPassword(): Promise<void> {
    if (!supabase) {
      this.notice.set('Não foi possível conectar ao servidor.');
      return;
    }

    const email = this.loginEmail.trim();

    if (!email) {
      this.notice.set('Informe seu e-mail acima para recuperar a senha.');
      return;
    }

    this.notice.set('Enviando solicitação...');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/login',
      });

      if (error) {
        this.notice.set('Não foi possível enviar o e-mail de recuperação.');
        return;
      }

      this.notice.set('Enviamos um link para redefinir sua senha. Verifique seu e-mail.');
    } catch {
      this.notice.set('Erro ao solicitar recuperação. Tente novamente.');
    }
  }

  protected previousSignupStep(): void {
    this.signupStep.set(0);
    this.notice.set('');
  }

  protected printReport(): void {
    if (this.visibleRecords().length) window.print();
  }

  protected formatDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      timeZone: 'America/Sao_Paulo',
    })
      .format(date)
      .replace('.', '');
  }

  protected formatTime(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  }
}
