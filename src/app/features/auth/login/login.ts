import { Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import { FormValidationService } from '../../../core/form-validation.service';
import { FieldErrorComponent } from '../../../shared/field-error/field-error';
import { LucideLockKeyhole, LucideLogIn, LucideMail } from '@lucide/angular';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, FieldErrorComponent, LucideLockKeyhole, LucideLogIn, LucideMail],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent {
  readonly auth = inject(AuthService);
  private readonly validation = inject(FormValidationService);
  readonly submitted = signal(false);

  @ViewChild('loginFields') private loginFields?: ElementRef<HTMLElement>;

  validEmail(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.auth.email().trim());
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    if (!this.validEmail() || !this.auth.loginPassword.trim()) {
      queueMicrotask(() => {
        if (this.loginFields) this.validation.focusFirstInvalidField(this.loginFields.nativeElement);
      });
      return;
    }
    await this.auth.login(this.auth.email(), this.auth.loginPassword);
  }
}
