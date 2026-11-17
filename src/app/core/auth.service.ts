import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase-client';
import { ToastService } from './toast';

export type AuthView = 'login' | 'signup' | 'recovery' | 'new-password';
export interface SignupProfile { name: string; crtr: string; workplace: string; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly view = signal<AuthView>('login');
  readonly email = signal('');
  readonly busy = signal(false);
  loginPassword = '';
  signupPassword = '';
  signupConfirmation = '';
  signupName = '';
  signupCrtr = '';
  signupWorkplace = 'Irmandade Santa Casa de Angatuba';
  constructor(private readonly router: Router, private readonly toast: ToastService) {}

  private async getClient(): Promise<SupabaseClient | null> {
    try {
      return await getSupabase();
    } catch {
      return null;
    }
  }

  show(view: AuthView): void { this.view.set(view); }
  showPasswordUpdate(): void { this.view.set('new-password'); }
  reset(): void { this.view.set('login'); this.email.set(''); this.loginPassword = ''; this.signupPassword = ''; this.signupConfirmation = ''; this.signupName = ''; this.signupCrtr = ''; this.signupWorkplace = 'Irmandade Santa Casa de Angatuba'; this.busy.set(false); }

  async login(email: string, password: string): Promise<void> {
    this.busy.set(true);
    const supabase = await this.getClient();
    if (!supabase) { this.toast.error('N\u00e3o foi poss\u00edvel conectar ao servidor.'); this.busy.set(false); return; }
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { this.toast.error('E-mail ou senha inv\u00e1lidos.'); return; }
      await this.router.navigateByUrl('/dashboard');
    } catch { this.toast.error('Erro ao conectar. Tente novamente.'); }
    finally { this.busy.set(false); }
  }

  async signup(email: string, password: string, profile: SignupProfile): Promise<void> {
    this.busy.set(true);
    const supabase = await this.getClient();
    if (!supabase) { this.toast.error('N\u00e3o foi poss\u00edvel conectar ao servidor.'); this.busy.set(false); return; }
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) { this.toast.error(error.message); return; }
      if (!data.user || !data.session) { this.toast.error('Conta criada, mas não foi poss\u00edvel iniciar a sess\u00e3o.'); return; }
      const { error: profileError } = await supabase.from('perfis').insert({ id: data.user.id, nome_completo: profile.name.trim(), numero_crtr: profile.crtr.trim(), local_trabalho: profile.workplace.trim() });
      if (profileError) { this.toast.error('Conta criada, mas houve um erro ao salvar o perfil: ' + profileError.message); return; }
      await this.router.navigateByUrl('/dashboard');
    } catch { this.toast.error('Erro ao criar a conta. Tente novamente.'); }
    finally { this.busy.set(false); }
  }

  async requestRecovery(email: string): Promise<void> {
    this.busy.set(true);
    const supabase = await this.getClient();
    if (!supabase) { this.toast.error('N\u00e3o foi poss\u00edvel conectar ao servidor.'); this.busy.set(false); return; }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/login' });
      if (error) { this.toast.error('N\u00e3o foi poss\u00edvel enviar o e-mail de recupera\u00e7\u00e3o.'); return; }
      this.toast.info('Enviamos um link para redefinir sua senha. Verifique seu e-mail.');
    } catch { this.toast.error('Erro ao solicitar recupera\u00e7\u00e3o. Tente novamente.'); }
    finally { this.busy.set(false); }
  }

  async updatePassword(password: string, confirmation: string): Promise<boolean> {
    this.busy.set(true);
    const supabase = await this.getClient();
    if (!supabase) { this.toast.error('N\u00e3o foi poss\u00edvel conectar ao servidor.'); this.busy.set(false); return false; }
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { this.toast.error('N\u00e3o foi poss\u00edvel atualizar a senha. Tente novamente.'); return false; }
      await supabase.auth.signOut({ scope: 'local' });
      this.view.set('login');
      this.toast.success('Senha alterada com sucesso! Entre com sua nova senha.');
      return true;
    } catch { this.toast.error('Erro ao atualizar a senha. Tente novamente.'); return false; }
    finally { this.busy.set(false); }
  }
}
