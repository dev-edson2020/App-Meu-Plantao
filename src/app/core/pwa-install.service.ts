
import { Injectable, signal } from '@angular/core';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

@Injectable({
  providedIn: 'root',
})
export class PwaInstallService {
  readonly canInstall = signal(false);

  private deferredPrompt: InstallPromptEvent | null = null;

  constructor() {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeinstallprompt', (event: Event) => {
      event.preventDefault();

      this.deferredPrompt = event as InstallPromptEvent;
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
    });
  }

  async install(): Promise<void> {
    if (!this.deferredPrompt) return;

    const prompt = this.deferredPrompt;
    this.deferredPrompt = null;
    this.canInstall.set(false);

    await prompt.prompt();
    await prompt.userChoice;
  }
}
