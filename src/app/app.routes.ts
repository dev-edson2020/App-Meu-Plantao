import { Component } from '@angular/core';
import { Routes } from '@angular/router';

@Component({
  selector: 'app-route-marker',
  standalone: true,
  template: '',
  styles: [':host { display: none !important; }'],
})
export class AppRouteMarkerComponent {}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: AppRouteMarkerComponent, data: { screen: 'welcome' } },
  { path: 'dashboard', component: AppRouteMarkerComponent, data: { screen: 'home' } },
  { path: 'register', component: AppRouteMarkerComponent, data: { screen: 'register' } },
  { path: 'records', component: AppRouteMarkerComponent, data: { screen: 'records' } },
  { path: 'reports', component: AppRouteMarkerComponent, data: { screen: 'reports' } },
  { path: 'profile', component: AppRouteMarkerComponent, data: { screen: 'profile' } },
  { path: '**', redirectTo: 'login' },
];
