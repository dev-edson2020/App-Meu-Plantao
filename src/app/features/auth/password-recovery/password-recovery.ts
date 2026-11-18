import { Component, ElementRef, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import { FormValidationService } from '../../../core/form-validation.service';
import { FieldErrorComponent } from '../../../shared/field-error/field-error';
import { LucideArrowLeft, LucideLockKeyhole, LucideMail } from '@lucide/angular';

@Component({
  selector: 'app-password-recovery',
  standalone: true,
  imports: [FormsModule, FieldErrorComponent, LucideArrowLeft, LucideLockKeyhole, LucideMail],
  templateUrl: './password-recovery.html',
  styleUrl: './password-recovery.scss',
})
export class PasswordRecoveryComponent {
  readonly auth = inject(AuthService);
  private readonly validation = inject(FormValidationService);
  readonly errors: Record<string, string> = {};
  password = '';
  confirmation = '';

  @ViewChild('recoveryFields') private recoveryFields?: ElementRef<HTMLElement>;

  validEmail(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.auth.email().trim());
  }

  passwordValid(password: string): boolean {
    return /^[\p{L}\p{N}]{6,}$/u.test(password);
  }

  clearError(field: string): void {
    delete this.errors[field];
  }

  async request(): Promise<void> {
    this.clearErrors();
    if (!this.auth.email().trim()) {
      this.errors['email'] = 'Informe seu e-mail para recuperar a senha.';
    } else if (!this.validEmail()) {
      this.errors['email'] = 'Informe um e-mail válido.';
    }
    if (Object.keys(this.errors).length) {
      this.focusInvalidField();
      return;
    }
    await this.auth.requestRecovery(this.auth.email());
  }

  async update(): Promise<void> {
    this.clearErrors();
    if (!this.password) this.errors['password'] = 'Informe sua nova senha.';
    else if (this.password.length < 6) this.errors['password'] = 'A senha deve ter pelo menos 6 caracteres.';
    else if (!this.passwordValid(this.password)) this.errors['password'] = 'Use somente letras e números, sem caracteres especiais.';
    if (!this.confirmation) this.errors['confirmation'] = 'Confirme sua nova senha.';
    else if (this.password !== this.confirmation) this.errors['confirmation'] = 'As senhas não são iguais.';

    if (Object.keys(this.errors).length) {
      this.focusInvalidField();
      return;
    }
    await this.auth.updatePassword(this.password, this.confirmation);
  }

  private clearErrors(): void {
    for (const field of Object.keys(this.errors)) delete this.errors[field];
  }

  private focusInvalidField(): void {
    if (this.recoveryFields) {
      queueMicrotask(() => {
        const container = this.recoveryFields?.nativeElement;
        if (!container) return;
        const firstError = Object.keys(this.errors)[0];
        const fieldNames: Record<string, string> = {
          email: 'recoveryEmail',
          password: 'newPassword',
          confirmation: 'confirmNewPassword',
        };
        const field = container.querySelector<HTMLInputElement>(`[name="${fieldNames[firstError]}"]`);
        if (field) {
          field.scrollIntoView({ behavior: 'smooth', block: 'center' });
          field.focus();
        } else {
          this.validation.focusFirstInvalidField(container);
        }
      });
    }
  }
}
