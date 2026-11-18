import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  void navigator.serviceWorker.register('/service-worker.js').catch((error) => {
    console.error('Não foi possível ativar o suporte offline do aplicativo:', error);
  });
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
