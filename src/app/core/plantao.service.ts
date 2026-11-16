
import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

export interface Plantao {
  id: string;
  usuario_id: string;
  data_hora_inicio: string;
  data_hora_fim: string | null;
}

export interface Atendimento {
  id: string;
  plantao_id: string;
  usuario_id: string;
  data_hora_entrada: string;
  data_hora_saida: string | null;
  foto_entrada: string;
  foto_saida: string | null;
  justificativa: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class PlantaoService {
  private readonly bucket = 'fotos-atendimentos';

  private async getUserId(): Promise<string> {
    if (!supabase) {
      throw new Error('Supabase não está configurado.');
    }

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw new Error('Usuário não autenticado.');
    }

    return data.user.id;
  }

  async getOpenPlantao(): Promise<Plantao | null> {
    if (!supabase) {
      throw new Error('Supabase não está configurado.');
    }

    const userId = await this.getUserId();

    const { data, error } = await supabase
      .from('plantoes')
      .select('id, usuario_id, data_hora_inicio, data_hora_fim')
      .eq('usuario_id', userId)
      .is('data_hora_fim', null)
      .order('data_hora_inicio', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error('Não foi possível consultar o plantão aberto.');
    }

    return data;
  }

  async startPlantao(dataHoraInicio: string): Promise<Plantao> {
    if (!supabase) {
      throw new Error('Supabase não está configurado.');
    }

    const userId = await this.getUserId();

    const plantaoAberto = await this.getOpenPlantao();

    if (plantaoAberto) {
      return plantaoAberto;
    }

    const { data, error } = await supabase
      .from('plantoes')
      .insert({
        usuario_id: userId,
        data_hora_inicio: dataHoraInicio,
        data_hora_fim: null,
      })
      .select('id, usuario_id, data_hora_inicio, data_hora_fim')
      .single();

    if (error || !data) {
      throw new Error('Não foi possível iniciar o plantão.');
    }

    return data;
  }

  async finishPlantao(plantaoId: string, dataHoraFim: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase não está configurado.');
    }

    const userId = await this.getUserId();

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
    if (!supabase) {
      throw new Error('Supabase não está configurado.');
    }

    const userId = await this.getUserId();

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

    return data;
  }

  async uploadPhoto(photo: File, plantaoId: string): Promise<string> {
    if (!supabase) {
      throw new Error('Supabase não está configurado.');
    }

    const userId = await this.getUserId();
    const extension = photo.name.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const filePath = `${userId}/${plantaoId}/${fileName}`;

    const { error } = await supabase.storage
      .from(this.bucket)
      .upload(filePath, photo, {
        contentType: photo.type,
        upsert: false,
      });

    if (error) {
      throw new Error('Não foi possível enviar a fotografia.');
    }

    return filePath;
  }

  async startAtendimento(
    plantaoId: string,
    dataHoraEntrada: string,
    fotoEntrada: string,
    justificativa: string | null,
  ): Promise<Atendimento> {
    if (!supabase) {
      throw new Error('Supabase não está configurado.');
    }

    const userId = await this.getUserId();

    const atendimentoAberto = await this.getOpenAtendimento(plantaoId);

    if (atendimentoAberto) {
      throw new Error('Encerre o atendimento atual antes de iniciar outro.');
    }

    const { data, error } = await supabase
      .from('atendimentos')
      .insert({
        plantao_id: plantaoId,
        usuario_id: userId,
        data_hora_entrada: dataHoraEntrada,
        foto_entrada: fotoEntrada,
        justificativa: justificativa || null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error('Não foi possível registrar a entrada.');
    }

    return data;
  }

  async finishAtendimento(
    atendimentoId: string,
    dataHoraSaida: string,
    fotoSaida: string,
    justificativa: string | null,
  ): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase não está configurado.');
    }

    const userId = await this.getUserId();

    const { error } = await supabase
      .from('atendimentos')
      .update({
        data_hora_saida: dataHoraSaida,
        foto_saida: fotoSaida,
        justificativa: justificativa || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', atendimentoId)
      .eq('usuario_id', userId)
      .is('data_hora_saida', null);

    if (error) {
      throw new Error('Não foi possível registrar a saída.');
    }
  }

  async deletePhoto(filePath: string): Promise<void> {
    if (!supabase) return;

    const { error } = await supabase.storage
      .from(this.bucket)
      .remove([filePath]);

    if (error) {
      throw new Error('Não foi possível remover a fotografia.');
    }
  }
}
