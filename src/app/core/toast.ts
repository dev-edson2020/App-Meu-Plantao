
import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  message: string;
  duration: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  readonly currentToast = signal<ToastMessage | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 0;

  show(
    type: ToastType,
    title: string,
    message: string,
    duration?: number
  ): void {
    const current = this.currentToast();

    if (
      current &&
      current.type === type &&
      current.title === title &&
      current.message === message
    ) {
      return;
    }

    this.clearTimer();

    const defaultDuration: Record<ToastType, number> = {
      success: 3000,
      info: 4000,
      warning: 5000,
      error: 0
    };

    const toastDuration = duration ?? defaultDuration[type];

    this.currentToast.set({
      id: ++this.nextId,
      type,
      title,
      message,
      duration: toastDuration
    });

    if (toastDuration > 0) {
      this.timer = setTimeout(() => {
        this.dismiss();
      }, toastDuration);
    }
  }

  success(message: string, title = 'Sucesso'): void {
    this.show('success', title, message);
  }

  info(message: string, title = 'Informação'): void {
    this.show('info', title, message);
  }

  warning(message: string, title = 'Atenção'): void {
    this.show('warning', title, message);
  }

  error(message: string, title = 'Erro'): void {
    this.show('error', title, message);
  }

  dismiss(): void {
    this.clearTimer();
    this.currentToast.set(null);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
