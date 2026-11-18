import { Injectable, computed, signal, OnDestroy, inject, effect, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { getSupabase } from './supabase-client';
import { PlantaoService } from './plantao.service';
import type { Plantao, Atendimento } from './plantao.service';
import { ToastService } from './toast';
import { FormValidationService } from './form-validation.service';
import { AuthService } from './auth.service';
import { OfflineSyncService } from './offline-sync.service';
import type { OfflineOperation, SyncStatus } from './offline-sync.service';
import type { SupabaseClient } from '@supabase/supabase-js';
export type Screen = 'welcome' | 'home' | 'register' | 'records' | 'reports' | 'profile';
type RecordKind = 'Entrada' | 'Saída';

export interface TimeRecord {
  id: string | number;
  attendanceId?: string;
  plantaoId?: string;
  photoUrl?: string | null;
  kind: RecordKind;
  occurredAt: Date;
  reason: string;
  photoName: string;
  localOperationId?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
  wasOffline?: boolean;
  localCreatedAt?: Date;
  syncedAt?: Date | null;
}

@Injectable({ providedIn: 'root' })
export class AppState implements OnDestroy {
  readonly offlineSync = inject(OfflineSyncService);
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
  private readonly offlinePhotoUrls = new Map<string, string>();
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

    effect(() => {
      const operations = this.offlineSync.operations();
      const byId = new Map(operations.map(operation => [operation.id, operation]));
      untracked(() => this.records.update(records => records.map(record => {
        if (!record.localOperationId) return record;
        const operation = byId.get(record.localOperationId);
        return operation ? this.applyOfflineMetadata(record, operation) : record;
      })));
    });

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
      if (session?.user) {
        this.auth.currentUserId.set(session.user.id);
        void this.offlineSync.refresh(session.user.id).then(() => this.offlineSync.syncNow(session.user.id));
      }
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
        this.auth.currentUserId.set(null);
        this.offlineSync.clearVisibleOperations();
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
    let savedOperation: OfflineOperation | undefined;
    this.recordSaving.set(true);
    try {
      const userId = await this.auth.restoreCurrentUserId();
      if (!userId) { this.notice.set('Entre novamente para registrar um plantão.'); return; }
      if (kind === 'Entrada') {
        if (this.activeAtendimento()) { this.notice.set('J\u00e1 existe um atendimento em andamento. Registre a Sa\u00edda primeiro.'); return; }
        let plantaoAtivo = this.activePlantao();
        if (!plantaoAtivo && this.offlineSync.online()) {
          plantaoAtivo = await this.plantaoService.getOpenPlantao();
          if (plantaoAtivo) {
            const atendimento = await this.plantaoService.getOpenAtendimento(plantaoAtivo.id);
            if (atendimento) { this.activePlantao.set(plantaoAtivo); this.activeAtendimento.set(atendimento); this.notice.set('J\u00e1 existe um atendimento em andamento. Registre a Sa\u00edda primeiro.'); return; }
            await this.offlineSync.saveServerContext(plantaoAtivo, null, userId);
          }
        }
        savedOperation = await this.offlineSync.enqueueEntry(userId, plantaoAtivo, this.selectedPhoto, occurredAt, reason, () => this.notice.set('Sincronizando registro'));
        const context = await this.offlineSync.getContext(userId);
        if (context) {
          this.activePlantao.set({ id: context.plantaoId, usuario_id: userId, data_hora_inicio: context.plantaoStartAt, data_hora_fim: null });
          this.activeAtendimento.set({ id: savedOperation.remoteAttendanceId ?? '', localAttendanceId: savedOperation.localAttendanceId, usuario_id: userId, plantao_id: context.plantaoId, data_hora_entrada: occurredAt.toISOString(), data_hora_saida: null, foto_entrada: '', foto_saida: null, justificativa: reason || null });
        }
      } else {
        const plantao = this.activePlantao();
        const atendimentoAtual = this.activeAtendimento();
        if (!plantao || !atendimentoAtual) { this.notice.set('N\u00e3o existe atendimento aberto para registrar a Sa\u00edda.'); return; }
        if (occurredAt.getTime() <= new Date(atendimentoAtual.data_hora_entrada).getTime()) { this.notice.set('A Sa\u00edda deve ter hor\u00e1rio posterior \u00e0 Entrada.'); return; }
        savedOperation = await this.offlineSync.enqueueExit(userId, plantao, atendimentoAtual, this.selectedPhoto, occurredAt, reason, () => this.notice.set('Sincronizando registro'));
        this.activeAtendimento.set(null);
      }
      this.selectedMonth.set(occurredAt.getMonth());
      this.selectedYear.set(occurredAt.getFullYear());
      this.notice.set(this.recordSaveMessage(savedOperation));
      void this.loadRecords();
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

  private recordSaveMessage(operation?: OfflineOperation): string {
    if (operation?.status === 'synced') return 'Registro salvo e sincronizado com sucesso';
    if (operation?.status === 'failed') {
      return `Registro salvo no dispositivo, mas houve falha na sincronização${operation.syncError ? `: ${operation.syncError}` : ''}`;
    }
    if (operation?.status === 'syncing') return 'Sincronizando registro';
    const detail = operation?.syncErrorCode === 'no-internet' && operation.syncError ? ` (${operation.syncError})` : '';
    return `Registro salvo no dispositivo. Aguardando sincronização${detail}`;
  }

  async loadRecords(): Promise<void> {
    this.recordsLoading.set(true);
    this.recordsError.set(false);
    try {
      const rows = await this.plantaoService.getAtendimentos();
      const events = await Promise.all(rows.map(async (row) => {
        const [entryUrl, exitUrl] = await Promise.all([this.plantaoService.getPhotoUrl(row.foto_entrada), this.plantaoService.getPhotoUrl(row.foto_saida)]);
        const mapped: TimeRecord[] = [{
          id: row.id + '-entrada', attendanceId: row.id, plantaoId: row.plantao_id, kind: 'Entrada',
          occurredAt: new Date(row.data_hora_entrada), reason: row.justificativa ?? '',
          photoName: row.foto_entrada?.split('/').pop() ?? '', photoUrl: entryUrl,
        }];
        if (row.data_hora_saida) mapped.push({
          id: row.id + '-saida', attendanceId: row.id, plantaoId: row.plantao_id, kind: 'Sa\u00edda',
          occurredAt: new Date(row.data_hora_saida), reason: row.justificativa ?? '',
          photoName: row.foto_saida?.split('/').pop() ?? '', photoUrl: exitUrl,
        });
        return mapped;
      }));
      let serverRecords = events.flat();
      const userId = this.auth.currentUserId() ?? await this.auth.restoreCurrentUserId();
      const operations = userId ? await this.offlineSync.getOperations(userId) : [];
      serverRecords = serverRecords.map(record => {
        const operation = operations.find(item => item.remoteAttendanceId === String(record.attendanceId) && item.kind === record.kind);
        return operation ? { ...record, attendanceId: operation.remoteAttendanceId ?? operation.localAttendanceId, reason: operation.reason, localOperationId: operation.id, syncStatus: operation.status, syncError: operation.syncError, wasOffline: operation.wasOffline, localCreatedAt: new Date(operation.createdAt), syncedAt: operation.syncedAt ? new Date(operation.syncedAt) : null } : record;
      });
      const localRecords = await Promise.all(operations.filter(operation => {
        return !operation.remoteAttendanceId || !serverRecords.some(record => String(record.attendanceId) === operation.remoteAttendanceId && record.kind === operation.kind);
      }).map(operation => this.mapOfflineOperation(operation)));
      this.records.set([...serverRecords, ...localRecords].sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime()));
    } catch (error) {
      console.error('Falha ao carregar registros:', error);
      const userId = this.auth.currentUserId() ?? await this.auth.restoreCurrentUserId().catch(() => null);
      try {
        const operations = userId ? await this.offlineSync.getOperations(userId) : [];
        const localRecords = await Promise.all(operations.map(operation => this.mapOfflineOperation(operation)));
        if (localRecords.length) {
          this.records.set(localRecords.sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime()));
          this.recordsError.set(false);
        } else this.recordsError.set(true);
      } catch { this.recordsError.set(true); }
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

  private applyOfflineMetadata(record: TimeRecord, operation: OfflineOperation): TimeRecord {
    return {
      ...record,
      syncStatus: operation.status,
      syncError: operation.syncError,
      wasOffline: operation.wasOffline,
      localCreatedAt: new Date(operation.createdAt),
      syncedAt: operation.syncedAt ? new Date(operation.syncedAt) : null,
    };
  }

  private async mapOfflineOperation(operation: OfflineOperation): Promise<TimeRecord> {
    let photoUrl: string | null = null;
    if (operation.photoBlob) {
      photoUrl = this.offlinePhotoUrls.get(operation.id) ?? URL.createObjectURL(operation.photoBlob);
      this.offlinePhotoUrls.set(operation.id, photoUrl);
    }
    return {
      id: operation.id, attendanceId: operation.remoteAttendanceId ?? operation.localAttendanceId, plantaoId: operation.plantaoId, kind: operation.kind,
      occurredAt: new Date(operation.occurredAt), reason: operation.reason, photoName: operation.photoName,
      photoUrl, localOperationId: operation.id, syncStatus: operation.status, wasOffline: operation.wasOffline,
      syncError: operation.syncError,
      localCreatedAt: new Date(operation.createdAt), syncedAt: operation.syncedAt ? new Date(operation.syncedAt) : null,
    };
  }

  private async loadActivePlantao(): Promise<void> {
    await this.restoreOfflineActivePlantao();
    try {
      const plantao = await this.plantaoService.getOpenPlantao();
      this.activePlantao.set(plantao);

      if (plantao) {
        const atendimento = await this.plantaoService.getOpenAtendimento(plantao.id);
        this.activeAtendimento.set(atendimento);
      } else {
        this.activeAtendimento.set(null);
      }
      const userId = this.auth.currentUserId();
      if (userId && plantao) await this.offlineSync.saveServerContext(plantao, this.activeAtendimento(), userId);
      if (userId && !plantao) {
        const context = await this.offlineSync.getContext(userId);
        const group = context ? (await this.offlineSync.getOperations(userId)).filter(operation => operation.plantaoId === context.plantaoId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
        const lastEntry = group.filter(operation => operation.kind === 'Entrada').at(-1);
        const lastExit = group.filter(operation => operation.kind === 'Sa\u00edda').at(-1);
        if (context && lastEntry && (!lastExit || lastEntry.createdAt > lastExit.createdAt)) {
          this.activePlantao.set({ id: context.plantaoId, usuario_id: userId, data_hora_inicio: context.plantaoStartAt, data_hora_fim: null });
          this.activeAtendimento.set({ id: lastEntry.remoteAttendanceId ?? '', localAttendanceId: lastEntry.localAttendanceId, usuario_id: userId, plantao_id: context.plantaoId, data_hora_entrada: lastEntry.occurredAt, data_hora_saida: null, foto_entrada: '', foto_saida: null, justificativa: lastEntry.reason || null });
        }
      }

    } catch {
      this.notice.set('Não foi possível carregar o plantão em andamento.');
    }
  }

  private async restoreOfflineActivePlantao(): Promise<void> {
    try {
    const userId = this.auth.currentUserId() ?? await this.auth.restoreCurrentUserId().catch(() => null);
    if (!userId) return;
    const context = await this.offlineSync.getContext(userId);
    if (!context) return;
    const group = (await this.offlineSync.getOperations(userId)).filter(operation => operation.plantaoId === context.plantaoId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const lastEntry = group.filter(operation => operation.kind === 'Entrada').at(-1);
    const lastExit = group.filter(operation => operation.kind === 'Sa\u00edda').at(-1);
    if (!lastEntry || (lastExit && lastExit.createdAt > lastEntry.createdAt)) return;
    this.activePlantao.set({ id: context.plantaoId, usuario_id: userId, data_hora_inicio: context.plantaoStartAt, data_hora_fim: null });
    this.activeAtendimento.set({ id: lastEntry.remoteAttendanceId ?? '', localAttendanceId: lastEntry.localAttendanceId, usuario_id: userId, plantao_id: context.plantaoId, data_hora_entrada: lastEntry.occurredAt, data_hora_saida: null, foto_entrada: '', foto_saida: null, justificativa: lastEntry.reason || null });
    } catch (error) {
      console.error('N\u00e3o foi poss\u00edvel restaurar o contexto local do plant\u00e3o:', error);
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
