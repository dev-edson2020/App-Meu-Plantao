import { Injectable, computed, signal, OnDestroy, inject, effect, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { getSupabase } from './supabase-client';
import { PlantaoService } from './plantao.service';
import type { Plantao, Atendimento } from './plantao.service';
import { ToastService } from './toast';
import { FormValidationService } from './form-validation.service';
import { AuthService } from './auth.service';
import type { SupabaseClient } from '@supabase/supabase-js';
export type Screen = 'welcome' | 'home' | 'register' | 'records' | 'reports' | 'profile';
type RecordKind = 'Entrada' | 'Saída';

export interface TimeRecord {
  id: string | number;
  plantaoId?: string;
  photoUrl?: string | null;
  kind: RecordKind;
  occurredAt: Date;
  reason: string;
  photoName: string;
}

@Injectable({ providedIn: 'root' })
export class AppState implements OnDestroy {
  private readonly formValidation = inject(FormValidationService);
  readonly profileSubmitted = signal(false);
  private readonly toastService = inject(ToastService);

  private readonly toastEffect = effect(() => {
    const message = this.notice();

    if (!message) return;

    const normalized = message.toLowerCase();

    if (normalized.includes('sucesso')) {
      this.toastService.success(message);
    } else if (
      normalized.includes('não foi possível') ||
      normalized.includes('erro') ||
      normalized.includes('inválid') ||
      normalized.includes('falha')
    ) {
      this.toastService.error(message);
    } else if (
      normalized.includes('atenção') ||
      normalized.includes('preencha') ||
      normalized.includes('informe') ||
      normalized.includes('selecione') ||
      normalized.includes('já existe') ||
      normalized.includes('não existe') ||
      normalized.includes('deve ter') ||
      normalized.includes('pelo menos') ||
      normalized.includes('não são iguais')
    ) {
      this.toastService.warning(message);
    } else {
      this.toastService.info(message);
    }
    untracked(() => this.notice.set(''));
  });

  readonly screen = signal<Screen>('welcome');
  readonly showExitConfirmation = signal(false);
  private readonly previousScreen = signal<Screen>('welcome');
  readonly recordKind = signal<RecordKind>('Entrada');
  readonly records = signal<TimeRecord[]>([]);
  readonly activePlantao = signal<Plantao | null>(null);
  readonly activeAtendimento = signal<Atendimento | null>(null);
  readonly notice = signal('');
  readonly recordsLoading = signal(false);
  readonly recordsError = signal(false);
  readonly recordSaving = signal(false);
  readonly includePhotosInPrint = signal(false);
  readonly clockNow = signal(new Date());
  readonly capturedAt = signal<Date | null>(null);
  private clockTimer: ReturnType<typeof setInterval> | undefined;
  private authListenerAttached = false;

  readonly now = new Date();
  reasonValue = '';
  photoName = '';
  selectedPhoto: File | null = null;
  photoPreviewUrl = '';
  readonly profileName = signal('');
  readonly crtrValue = signal('');
  readonly crtrRegionValue = signal('');
  readonly workplaceValue = signal('Irmandade Santa Casa de Angatuba');
  readonly selectedMonth = signal(this.now.getMonth());
  readonly selectedYear = signal(this.now.getFullYear());

  readonly crtrDisplay = computed(
    () =>
      [this.crtrValue(), this.crtrRegionValue()].filter(Boolean).join(' · ') || 'CRTR não informado',
  );

  constructor(
    private readonly router: Router,
    private readonly plantaoService: PlantaoService,
    readonly auth: AuthService,
  ) {
    this.screen.set(this.screenFromUrl(this.router.url));

    this.clockTimer = setInterval(() => {
      this.clockNow.set(new Date());
    }, 1000);

    if (this.screen() !== 'welcome' || window.location.hash.includes('type=recovery')) {
      void this.attachAuthListener();
    }

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const nextScreen = this.screenFromUrl(event.urlAfterRedirects);

        if (this.screen() !== nextScreen) {
          this.previousScreen.set(this.screen());
          this.screen.set(nextScreen);
        }

        if (nextScreen !== 'welcome') void this.attachAuthListener();
      });
  }

  private async attachAuthListener(): Promise<void> {
    if (this.authListenerAttached) return;
    this.authListenerAttached = true;
    let supabase: SupabaseClient | null;
    try {
      supabase = await getSupabase();
    } catch {
      this.authListenerAttached = false;
      this.notice.set('Não foi possível conectar ao servidor.');
      return;
    }
    if (!supabase) {
      this.authListenerAttached = false;
      return;
    }

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        this.auth.showPasswordUpdate();
        this.screen.set('welcome');
        this.notice.set('Digite sua nova senha.');
        return;
      }

      if (event === 'SIGNED_IN' && session) {
        void this.loadProfile(session.user.id);
        void this.loadActivePlantao();
        void this.loadRecords();
      }

      if (event === 'INITIAL_SESSION' && session) {
        void this.loadProfile(session.user.id);
        void this.loadActivePlantao();
        void this.loadRecords();
      }

      if (event === 'SIGNED_OUT') {
        this.profileName.set('');
        this.crtrValue.set('');
        this.crtrRegionValue.set('');
        this.workplaceValue.set('');
        this.activePlantao.set(null);
        this.activeAtendimento.set(null);
        this.records.set([]);
        this.recordsError.set(false);
      }
    });
  }

  captureRecordKind(kind: RecordKind): void {
    this.recordKind.set(kind);
    this.capturedAt.set(new Date());
  }

  ngOnDestroy(): void {
    if (this.clockTimer !== undefined) {
      clearInterval(this.clockTimer);
    }
  }

  readonly monthLabel = computed(() =>
    new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    })
      .format(new Date(this.selectedYear(), this.selectedMonth(), 1))
      .replace(/^./, (letter) => letter.toLocaleUpperCase('pt-BR')),
  );

  readonly visibleRecords = computed(() =>
    this.records()
      .filter(
        (record) =>
          record.occurredAt.getMonth() === this.selectedMonth() &&
          record.occurredAt.getFullYear() === this.selectedYear(),
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
  );

  private readonly currentMonthRecords = computed(() =>
    {
      const now = this.clockNow();
      return this.records().filter(
        (record) =>
          record.occurredAt.getMonth() === now.getMonth() &&
          record.occurredAt.getFullYear() === now.getFullYear(),
      );
    },
  );

  readonly plantaoCount = computed(
    () => new Set(this.currentMonthRecords().map((record) => record.plantaoId).filter(Boolean)).size,
  );

  readonly recordCount = computed(() => this.visibleRecords().length);
  readonly reportPlantaoCount = computed(
    () => new Set(this.visibleRecords().map((record) => record.plantaoId).filter(Boolean)).size,
  );

  readonly reportHours = computed(() => this.hoursForMonth(this.selectedMonth(), this.selectedYear()));
  readonly currentMonthHours = computed(() => {
    const now = this.clockNow();
    return this.hoursForMonth(now.getMonth(), now.getFullYear());
  });

  private hoursForMonth(month: number, year: number): string {
    const events = this.records().slice().sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const intervals: Array<[number, number]> = [];
    let open: { timestamp: number; month: number; year: number } | null = null;

    for (const event of events) {
      if (event.kind === 'Entrada' && open === null) {
        open = {
          timestamp: event.occurredAt.getTime(),
          month: event.occurredAt.getMonth(),
          year: event.occurredAt.getFullYear(),
        };
      } else if (event.kind === 'Saída' && open !== null && event.occurredAt.getTime() > open.timestamp) {
        if (open.month === month && open.year === year) {
          intervals.push([open.timestamp, event.occurredAt.getTime()]);
        }
        open = null;
      }
    }

    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let merged: [number, number] | null = null;
    for (const interval of intervals) {
      if (!merged || interval[0] > merged[1]) {
        if (merged) total += merged[1] - merged[0];
        merged = [...interval];
      } else {
        merged[1] = Math.max(merged[1], interval[1]);
      }
    }
    if (merged) total += merged[1] - merged[0];

    return `${Math.floor(total / 3_600_000)}h ${String(
      Math.floor((total % 3_600_000) / 60_000),
    ).padStart(2, '0')}min`;
  }

  go(screen: Screen): void {
    this.notice.set('');
    void this.router.navigateByUrl(this.urlForScreen(screen));
  }

  goBack(): void {
    const previous = this.previousScreen();
    this.go(previous === 'welcome' ? 'home' : previous);
  }

  requestExit(): void {
    this.showExitConfirmation.set(true);
  }

  cancelExit(): void {
    this.showExitConfirmation.set(false);
  }

  confirmExit(): void {
    this.showExitConfirmation.set(false);
    this.auth.reset();
    this.go('welcome');
    void this.signOutCurrentSession();
  }

  private async signOutCurrentSession(): Promise<void> {
    try {
      const supabase = await getSupabase();

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

  changeMonth(offset: number): void {
    const next = new Date(this.selectedYear(), this.selectedMonth() + offset, 1);
    this.selectedMonth.set(next.getMonth());
    this.selectedYear.set(next.getFullYear());
  }

  handlePhoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    this.setPhotoFile(file);
  }

  setPhotoFile(file: File): void {

    if (this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
    }

    this.selectedPhoto = file;
    this.photoName = file.name;
    this.photoPreviewUrl = URL.createObjectURL(file);
  }

  clearPhoto(...inputs: HTMLInputElement[]): void {
    if (this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
    }

    this.selectedPhoto = null;
    this.photoName = '';
    this.photoPreviewUrl = '';
    for (const input of inputs) input.value = '';
  }

  async saveRecord(): Promise<void> {
    if (this.recordSaving()) return;
    const occurredAt = this.capturedAt();
    if (!occurredAt) { this.notice.set('Selecione Entrada ou Sa\u00edda para capturar o hor\u00e1rio.'); return; }
    if (!this.selectedPhoto) { this.notice.set('Adicione uma foto para continuar.'); return; }
    const kind = this.recordKind();
    const reason = this.reasonValue.trim();
    this.recordSaving.set(true);
    try {
      if (kind === 'Entrada') {
        if (this.activeAtendimento()) { this.notice.set('J\u00e1 existe um atendimento em andamento. Registre a Sa\u00edda primeiro.'); return; }
        const plantao = await this.plantaoService.startPlantao(occurredAt.toISOString());
        this.activePlantao.set(plantao);
        const photoPath = await this.plantaoService.uploadPhoto(this.selectedPhoto, plantao.id);
        const atendimento = await this.plantaoService.startAtendimento(plantao.id, occurredAt.toISOString(), photoPath, reason || null);
        this.activeAtendimento.set(atendimento);
      } else {
        const plantao = this.activePlantao();
        const atendimentoAtual = this.activeAtendimento();
        if (!plantao || !atendimentoAtual) { this.notice.set('N\u00e3o existe atendimento aberto para registrar a Sa\u00edda.'); return; }
        if (occurredAt.getTime() <= new Date(atendimentoAtual.data_hora_entrada).getTime()) { this.notice.set('A Sa\u00edda deve ter hor\u00e1rio posterior \u00e0 Entrada.'); return; }
        const photoPath = await this.plantaoService.uploadPhoto(this.selectedPhoto, plantao.id);
        await this.plantaoService.finishAtendimento(atendimentoAtual.id, occurredAt.toISOString(), photoPath, reason || null);
        this.activeAtendimento.set(null);
      }
      this.selectedMonth.set(occurredAt.getMonth());
      this.selectedYear.set(occurredAt.getFullYear());
      await this.loadRecords();
      this.notice.set(kind === 'Entrada' ? 'Entrada registrada com sucesso!' : 'Sa\u00edda registrada com sucesso!');
      this.reasonValue = '';
      this.selectedPhoto = null;
      this.photoName = '';
      this.capturedAt.set(null);
      if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
      this.photoPreviewUrl = '';
    } catch (error) {
      console.error('Erro ao salvar registro:', error);
      this.notice.set('N\u00e3o foi poss\u00edvel salvar o registro. Verifique sua conexão e tente novamente.');
    } finally { this.recordSaving.set(false); }
  }

  async loadRecords(): Promise<void> {
    this.recordsLoading.set(true);
    this.recordsError.set(false);
    try {
      const rows = await this.plantaoService.getAtendimentos();
      const events = await Promise.all(rows.map(async (row) => {
        const [entryUrl, exitUrl] = await Promise.all([this.plantaoService.getPhotoUrl(row.foto_entrada), this.plantaoService.getPhotoUrl(row.foto_saida)]);
        const mapped: TimeRecord[] = [{
          id: row.id + '-entrada', plantaoId: row.plantao_id, kind: 'Entrada',
          occurredAt: new Date(row.data_hora_entrada), reason: row.justificativa ?? '',
          photoName: row.foto_entrada?.split('/').pop() ?? '', photoUrl: entryUrl,
        }];
        if (row.data_hora_saida) mapped.push({
          id: row.id + '-saida', plantaoId: row.plantao_id, kind: 'Sa\u00edda',
          occurredAt: new Date(row.data_hora_saida), reason: row.justificativa ?? '',
          photoName: row.foto_saida?.split('/').pop() ?? '', photoUrl: exitUrl,
        });
        return mapped;
      }));
      this.records.set(events.flat().sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime()));
    } catch (error) {
      console.error('Falha ao carregar registros:', error);
      this.recordsError.set(true);
    } finally { this.recordsLoading.set(false); }
  }

  private async loadProfile(userId: string): Promise<void> {
    let supabase: SupabaseClient | null;
    try {
      supabase = await getSupabase();
    } catch {
      this.notice.set('Não foi possível carregar seus dados profissionais.');
      return;
    }
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

    this.profileName.set(data.nome_completo ?? '');
    this.crtrValue.set(data.numero_crtr ?? '');
    this.crtrRegionValue.set('');
    this.workplaceValue.set(data.local_trabalho ?? '');

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

    } catch {
      this.notice.set('Não foi possível carregar o plantão em andamento.');
    }
  }

  async saveProfile(profileFields?: HTMLElement): Promise<void> {
    this.profileSubmitted.set(true);

    if (!this.profileName().trim() || !this.crtrValue().trim() || !this.workplaceValue().trim()) {

      if (profileFields) {
        this.formValidation.focusFirstInvalidField(profileFields);
      }

      return;
    }

    let supabase: SupabaseClient | null;
    try {
      supabase = await getSupabase();
    } catch {
      this.notice.set('Não foi possível conectar ao servidor.');
      return;
    }
    if (!supabase) {
      this.notice.set('Não foi possível conectar ao servidor.');
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      this.notice.set('Sua sessão expirou. Entre novamente.');
      return;
    }

    const { error } = await supabase
      .from('perfis')
      .update({
        nome_completo: this.profileName().trim(),
        numero_crtr: this.crtrValue().trim(),
        local_trabalho: this.workplaceValue().trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userData.user.id);

    if (error) {
      this.notice.set('Não foi possível salvar as alterações.');
      return;
    }

    this.profileSubmitted.set(false);
    this.notice.set('Cadastro atualizado com sucesso!');
  }

  printReport(withPhotos = false): void {
    if (this.visibleRecords().length) { this.includePhotosInPrint.set(withPhotos); window.print(); }
  }

  formatDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      timeZone: 'America/Sao_Paulo',
    })
      .format(date)
      .replace('.', '');
  }

  formatTime(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  }

  captureCurrentAction(): void {
    const kind = this.activeAtendimento() ? 'Saída' : 'Entrada';

    this.recordKind.set(kind);
    this.capturedAt.set(new Date());
  }
}
