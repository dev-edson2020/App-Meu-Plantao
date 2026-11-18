
import { Injectable } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase-client';

export interface Plantao {
  id: string;
  usuario_id: string;
  data_hora_inicio: string;
  data_hora_fim: string | null;
}

export interface Atendimento {
  /** Remote atendimentos.id (PostgreSQL BIGINT), represented as a decimal string. */
  id: string;
  /** Local-only identifier used to pair queued entry/exit operations. */
  localAttendanceId?: string;
  plantao_id: string;
  usuario_id: string;
  data_hora_entrada: string;
  data_hora_saida: string | null;
  foto_entrada: string;
  foto_saida: string | null;
  justificativa: string | null;
}

export type PlantaoFailureKind = 'supabase-unavailable' | 'photo-upload' | 'record-write' | 'communication' | 'authentication';

export class PlantaoServiceError extends Error {
  constructor(readonly kind: PlantaoFailureKind, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PlantaoServiceError';
  }
}

@Injectable({
  providedIn: 'root',
})
export class PlantaoService {
  private readonly bucket = 'fotos-atendimentos';

  private async getClient(): Promise<SupabaseClient | null> {
    try {
      return await getSupabase();
    } catch {
      return null;
    }
  }

  private async getUserId(supabase: SupabaseClient): Promise<string> {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      const status = (error as { status?: number }).status;
      if (status !== 401 && status !== 403) throw this.apiError('record-write', 'Falha ao validar a sessão.', error);
      throw new PlantaoServiceError('authentication', 'Sessão inválida ou expirada.', error);
    }
    if (!data.user) {
      throw new PlantaoServiceError('authentication', 'Usuário não autenticado.', error);
    }

    return data.user.id;
  }

  async getAtendimentos(): Promise<Atendimento[]> {
    const supabase = await this.getClient();
    if (!supabase) throw new PlantaoServiceError('supabase-unavailable', 'Supabase indisponível ou não configurado.');
    const userId = await this.getUserId(supabase);
    const { data, error } = await supabase
      .from('atendimentos')
      .select('*')
      .eq('usuario_id', userId)
      .order('data_hora_entrada', { ascending: false });
    if (error) throw new Error('N\u00e3o foi poss\u00edvel consultar os registros.');
    return (data ?? []).map(row => ({ ...row, id: String(row.id) }));
  }

  async getPhotoUrl(filePath: string | null): Promise<string | null> {
    const supabase = await this.getClient();
    if (!supabase || !filePath) return null;
    const { data, error } = await supabase.storage.from(this.bucket).createSignedUrl(filePath, 3600);
    return error ? null : data.signedUrl;
  }

  async getOpenPlantao(): Promise<Plantao | null> {
    const supabase = await this.getClient();
    if (!supabase) {
      throw new PlantaoServiceError('supabase-unavailable', 'Supabase indisponível ou não configurado.');
    }

    const userId = await this.getUserId(supabase);

    const { data, error } = await supabase
      .from('plantoes')
      .select('id, usuario_id, data_hora_inicio, data_hora_fim')
      .eq('usuario_id', userId)
      .is('data_hora_fim', null)
      .order('data_hora_inicio', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw this.apiError('record-write', 'Falha ao consultar o plantão aberto.', error);
    }

    return data;
  }

  async startPlantao(dataHoraInicio: string, idempotencyId?: string): Promise<Plantao> {
    const supabase = await this.getClient();
    if (!supabase) {
      throw new PlantaoServiceError('supabase-unavailable', 'Supabase indisponível ou não configurado.');
    }

    const userId = await this.getUserId(supabase);

    if (!idempotencyId) {
      const plantaoAberto = await this.getOpenPlantao();
      if (plantaoAberto) return plantaoAberto;
    }

    const { data, error } = await supabase
      .from('plantoes')
      .insert({
        ...(idempotencyId ? { id: idempotencyId } : {}),
        usuario_id: userId,
        data_hora_inicio: dataHoraInicio,
        data_hora_fim: null,
      })
      .select('id, usuario_id, data_hora_inicio, data_hora_fim')
      .single();

    if (error || !data) {
      if (idempotencyId) {
        const { data: existing, error: lookupError } = await supabase
          .from('plantoes')
          .select('id, usuario_id, data_hora_inicio, data_hora_fim')
          .eq('id', idempotencyId)
          .eq('usuario_id', userId)
          .maybeSingle();
        if (!lookupError && existing && existing.data_hora_inicio === dataHoraInicio) return existing;
      }
      throw this.apiError('record-write', 'Falha na gravação do plantão.', error);
    }

    return data;
  }

  async finishPlantao(plantaoId: string, dataHoraFim: string): Promise<void> {
    const supabase = await this.getClient();
    if (!supabase) {
      throw new PlantaoServiceError('supabase-unavailable', 'Supabase indisponível ou não configurado.');
    }

    const userId = await this.getUserId(supabase);

    const { data: atendimentoAberto, error: atendimentoError } = await supabase
      .from('atendimentos')
      .select('id')
      .eq('plantao_id', plantaoId)
      .eq('usuario_id', userId)
      .is('data_hora_saida', null)
      .limit(1)
      .maybeSingle();

    if (atendimentoError) {
      throw new Error('Não foi possível verificar os atendimentos.');
    }

    if (atendimentoAberto) {
      throw new Error('Encerre o atendimento aberto antes de encerrar o plantão.');
    }

    const { error } = await supabase
      .from('plantoes')
      .update({ data_hora_fim: dataHoraFim })
      .eq('id', plantaoId)
      .eq('usuario_id', userId)
      .is('data_hora_fim', null);

    if (error) {
      throw new Error('Não foi possível encerrar o plantão.');
    }
  }

  async getOpenAtendimento(plantaoId: string): Promise<Atendimento | null> {
    const supabase = await this.getClient();
    if (!supabase) {
      throw new PlantaoServiceError('supabase-unavailable', 'Supabase indisponível ou não configurado.');
    }

    const userId = await this.getUserId(supabase);

    const { data, error } = await supabase
      .from('atendimentos')
      .select('*')
      .eq('plantao_id', plantaoId)
      .eq('usuario_id', userId)
      .is('data_hora_saida', null)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error('Não foi possível consultar o atendimento aberto.');
    }

    return data ? { ...data, id: String(data.id) } : null;
  }

  async uploadPhoto(photo: File, plantaoId: string, idempotencyId?: string): Promise<string> {
    const supabase = await this.getClient();
    if (!supabase) {
      throw new PlantaoServiceError('supabase-unavailable', 'Supabase indisponível ou não configurado.');
    }

    const userId = await this.getUserId(supabase);
    const extension = photo.name.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `${idempotencyId ?? crypto.randomUUID()}.${extension}`;
    const filePath = `${userId}/${plantaoId}/${fileName}`;

    const { error } = await supabase.storage
      .from(this.bucket)
      .upload(filePath, photo, {
        contentType: photo.type,
        upsert: false,
      });

    if (error) {
      if (idempotencyId) {
        const { error: existingError } = await supabase.storage.from(this.bucket).createSignedUrl(filePath, 60);
        if (!existingError) return filePath;
      }
      throw this.apiError('photo-upload', 'Falha no upload da fotografia.', error);
    }

    return filePath;
  }

  async startAtendimento(
    plantaoId: string,
    dataHoraEntrada: string,
    fotoEntrada: string,
    justificativa: string | null,
    idempotencyId?: string,
    localAttendanceId?: string,
  ): Promise<Atendimento> {
    const supabase = await this.getClient();
    if (!supabase) {
      throw new PlantaoServiceError('supabase-unavailable', 'Supabase indisponível ou não configurado.');
    }

    const userId = await this.getUserId(supabase);

    if (idempotencyId) {
      const existing = await this.findIdempotentEntry(supabase, userId, plantaoId, dataHoraEntrada, fotoEntrada, justificativa);
      if (existing) return existing;
    } else {
      const atendimentoAberto = await this.getOpenAtendimento(plantaoId);
      if (atendimentoAberto) throw new Error('Encerre o atendimento atual antes de iniciar outro.');
    }

    const { data, error } = await supabase
      .from('atendimentos')
      .insert(this.attendanceEntryPayload({
        plantao_id: plantaoId,
        usuario_id: userId,
        data_hora_entrada: dataHoraEntrada,
        foto_entrada: fotoEntrada,
        justificativa: justificativa || null,
      }, { operationId: idempotencyId, localAttendanceId }))
      .select('*')
      .single();

    this.logAttendanceResponse('PlantaoService.startAtendimento', {
      operationId: idempotencyId ?? null,
      localAttendanceId: localAttendanceId ?? null,
      remoteAttendanceId: null,
      table: 'atendimentos',
      payload: {
        plantao_id: plantaoId,
        usuario_id: '[redacted]',
        data_hora_entrada: dataHoraEntrada,
        foto_entrada: '[redacted storage path]',
        justificativa: justificativa ? '[redacted]' : null,
      },
      response: { id: data?.id == null ? null : String(data.id), error: this.supabaseErrorDetails(error) },
    });

    if (error || !data) {
      if (idempotencyId) {
        const existing = await this.findIdempotentEntry(supabase, userId, plantaoId, dataHoraEntrada, fotoEntrada, justificativa);
        if (existing) return existing;
      }
      throw this.apiError('record-write', 'Falha na gravação da entrada.', error);
    }

    return { ...data, id: String(data.id) };
  }

  async finishAtendimento(
    remoteAttendanceId: string,
    dataHoraSaida: string,
    fotoSaida: string,
    justificativa: string | null,
    operationId?: string,
    localAttendanceId?: string,
  ): Promise<void> {
    if (!/^\d+$/.test(remoteAttendanceId)) {
      throw new PlantaoServiceError('record-write', 'Identificador remoto de atendimento inválido: era esperado um BIGINT decimal.');
    }
    const supabase = await this.getClient();
    if (!supabase) {
      throw new PlantaoServiceError('supabase-unavailable', 'Supabase indisponível ou não configurado.');
    }

    const userId = await this.getUserId(supabase);

    const { data, error } = await supabase
      .from('atendimentos')
      .update({
        data_hora_saida: dataHoraSaida,
        foto_saida: fotoSaida,
        justificativa: justificativa || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', remoteAttendanceId)
      .eq('usuario_id', userId)
      .is('data_hora_saida', null)
      .select('id')
      .maybeSingle();

    this.logAttendanceResponse('PlantaoService.finishAtendimento', {
      operationId: operationId ?? null,
      localAttendanceId: localAttendanceId ?? null,
      remoteAttendanceId,
      table: 'atendimentos',
      payload: {
        data_hora_saida: dataHoraSaida,
        foto_saida: '[redacted storage path]',
        justificativa: justificativa ? '[redacted]' : null,
        updated_at: '[generated timestamp]',
      },
      response: { id: data?.id == null ? null : String(data.id), error: this.supabaseErrorDetails(error) },
    });

    if (error) {
      throw this.apiError('record-write', 'Falha na gravação da saída.', error);
    }
    if (!data) {
      const { data: existing, error: lookupError } = await supabase
        .from('atendimentos')
        .select('id, data_hora_saida, foto_saida')
        .eq('id', remoteAttendanceId)
        .eq('usuario_id', userId)
        .maybeSingle();
      if (lookupError || !existing || existing.data_hora_saida !== dataHoraSaida || existing.foto_saida !== fotoSaida) {
        throw this.apiError('record-write', 'Falha na confirma\u00e7\u00e3o da sa\u00edda.', lookupError);
      }
    }
  }

  private attendanceEntryPayload<T extends Record<string, unknown>>(
    payload: T,
    context: { operationId?: string; localAttendanceId?: string },
  ): T {
    const hasId = Object.prototype.hasOwnProperty.call(payload, 'id');
    const isUuid = typeof payload['id'] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload['id']);
    console.info('[supabase] preparando insert', {
      operationId: context.operationId ?? null,
      localAttendanceId: context.localAttendanceId ?? null,
      remoteAttendanceId: null,
      functionName: 'PlantaoService.startAtendimento',
      table: 'atendimentos',
      payload: {
        ...payload,
        usuario_id: '[redacted]',
        foto_entrada: '[redacted storage path]',
        justificativa: payload['justificativa'] ? '[redacted]' : null,
      },
      idPropertyPresent: hasId,
      uuidIdProperty: isUuid,
    });
    if (hasId && isUuid) {
      throw new PlantaoServiceError('record-write', 'Envio de entrada bloqueado: atendimentos.id não aceita UUID.');
    }
    if (hasId) {
      throw new PlantaoServiceError('record-write', 'Envio de entrada bloqueado: o ID BIGINT deve ser gerado pelo Supabase.');
    }
    return payload;
  }

  private supabaseErrorDetails(error: unknown): unknown {
    if (!error || typeof error !== 'object') return error ?? null;
    const details = error as { code?: string; message?: string; details?: string; hint?: string; status?: number };
    return { code: details.code, message: details.message, details: details.details, hint: details.hint, status: details.status };
  }

  private logAttendanceResponse(functionName: string, details: Record<string, unknown>): void {
    console.info('[supabase] resposta de atendimentos', { functionName, ...details });
  }

  async deletePhoto(filePath: string): Promise<void> {
    const supabase = await this.getClient();
    if (!supabase) return;

    const { error } = await supabase.storage
      .from(this.bucket)
      .remove([filePath]);

    if (error) {
      throw new Error('Não foi possível remover a fotografia.');
    }
  }

  private async findIdempotentEntry(
    supabase: SupabaseClient,
    userId: string,
    plantaoId: string,
    dataHoraEntrada: string,
    fotoEntrada: string,
    justificativa: string | null,
  ): Promise<Atendimento | null> {
    const { data, error } = await supabase
      .from('atendimentos')
      .select('*')
      .eq('usuario_id', userId)
      .eq('plantao_id', plantaoId)
      .eq('foto_entrada', fotoEntrada)
      .maybeSingle();

    if (error) throw this.apiError('record-write', 'Falha ao confirmar uma entrada já enviada.', error);
    if (!data) return null;
    if (data.data_hora_entrada !== dataHoraEntrada || (data.justificativa ?? null) !== (justificativa || null)) {
      throw new PlantaoServiceError('record-write', 'A fotografia idempotente já está associada a dados de entrada diferentes.');
    }
    return { ...data, id: String(data.id) };
  }

  private apiError(kind: Exclude<PlantaoFailureKind, 'authentication' | 'supabase-unavailable'>, message: string, cause: unknown): PlantaoServiceError {
    const details = cause as { status?: number; message?: string; name?: string } | null;
    const diagnostic = `${details?.name ?? ''} ${details?.message ?? ''}`.toLowerCase();
    if (kind === 'photo-upload') {
      const communicationFailure = cause instanceof TypeError || details?.name === 'AbortError' || /failed to fetch|network|fetch failed|timed? ?out|timeout/.test(diagnostic);
      const categoryMessage = communicationFailure
        ? 'Falha temporária de comunicação durante o upload da fotografia.'
        : message;
      return new PlantaoServiceError(kind, `${categoryMessage}${details?.status ? ` HTTP ${details.status}.` : ''}${details?.message ? ` ${details.message}` : ''}`, cause);
    }
    if (cause instanceof TypeError || details?.name === 'AbortError' || /failed to fetch|network|fetch failed|timed? ?out|timeout/.test(diagnostic)) {
      return new PlantaoServiceError('communication', 'Falha temporária de comunicação com o Supabase.', cause);
    }
    if (details?.status !== undefined && details.status >= 500 && details.status <= 599) {
      return new PlantaoServiceError('supabase-unavailable', `${message} Supabase respondeu com HTTP ${details.status}.`, cause);
    }
    return new PlantaoServiceError(kind, `${message}${details?.message ? ` ${details.message}` : ''}`, cause);
  }
}
