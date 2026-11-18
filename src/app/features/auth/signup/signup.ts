import { Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import { FormValidationService } from '../../../core/form-validation.service';
import { FieldErrorComponent } from '../../../shared/field-error/field-error';
import { LucideArrowRight, LucideBuilding, LucideCheck, LucideLockKeyhole, LucideMail, LucideUserRound } from '@lucide/angular';

@Component({ selector: 'app-signup', standalone: true, imports: [FormsModule, FieldErrorComponent, LucideArrowRight, LucideBuilding, LucideCheck, LucideLockKeyhole, LucideMail, LucideUserRound], templateUrl: './signup.html', styleUrl: './signup.scss' })
export class SignupComponent {
  readonly auth = inject(AuthService);
  private readonly validation = inject(FormValidationService);
  readonly step = signal(0);
  readonly errors = signal<Record<string, string>>({});
  @ViewChild('signupFields') private signupFields?: ElementRef<HTMLElement>;

  emailValid(): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.auth.email().trim()); }
  passwordValid(password: string): boolean { return /^[\p{L}\p{N}]{6,}$/u.test(password); }
  crtrValid(): boolean { return /^\d{5}[A-Z]$/.test(this.auth.signupCrtr); }
  updateCrtr(value: string): void {
    this.auth.signupCrtr = value.toUpperCase();
    if (this.errors()['crtr'] && this.crtrValid()) this.clearError('crtr');
  }
  clearError(field: string): void {
    const next = { ...this.errors() };
    delete next[field];
    this.errors.set(next);
  }
  back(): void { this.errors.set({}); this.step.set(0); }
  private showErrors(errors: Record<string, string>): void {
    this.errors.set(errors);
    if (Object.keys(errors).length) queueMicrotask(() => { if (this.signupFields) this.validation.focusFirstInvalidField(this.signupFields.nativeElement); });
  }
  async submit(): Promise<void> {
    this.errors.set({});
    if (this.step() === 0) {
      const errors: Record<string, string> = {};
      if (!this.auth.signupName.trim()) errors["name"] = 'Informe seu nome completo.';
      if (!this.crtrValid()) errors["crtr"] = 'Informe um CRTR completo com 5 números e 1 letra.';
      if (!this.auth.signupWorkplace.trim()) errors["workplace"] = 'Informe o local de trabalho.';
      if (Object.keys(errors).length) { this.showErrors(errors); return; }
      this.step.set(1);
      return;
    }
    const errors: Record<string, string> = {};
    if (!this.auth.email().trim()) errors["email"] = 'Informe seu e-mail.';
    else if (!this.emailValid()) errors["email"] = 'Informe um e-mail válido.';
    if (!this.auth.signupPassword) errors["password"] = 'Informe sua senha.';
    else if (this.auth.signupPassword.length < 6) errors["password"] = 'A senha deve ter pelo menos 6 caracteres.';
    else if (!this.passwordValid(this.auth.signupPassword)) errors["password"] = 'Use somente letras e números, sem caracteres especiais.';
    if (!this.auth.signupConfirmation) errors["confirmation"] = 'Confirme sua senha.';
    else if (this.auth.signupPassword !== this.auth.signupConfirmation) errors["confirmation"] = 'As senhas não são iguais.';
    if (Object.keys(errors).length) { this.showErrors(errors); return; }
    await this.auth.signup(this.auth.email(), this.auth.signupPassword, { name: this.auth.signupName, crtr: this.auth.signupCrtr.toUpperCase(), workplace: this.auth.signupWorkplace });
  }
}
