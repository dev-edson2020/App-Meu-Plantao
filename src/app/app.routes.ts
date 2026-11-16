import { Component, inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { supabase } from './core/supabase-client';

@Component({
  selector: 'app-route-marker',
  standalone: true,
  template: '',
  styles: [':host { display: none !important; }'],
})
export class AppRouteMarkerComponent {}

const requireAuth: CanActivateFn = async () => {
  const router = inject(Router);

  if (!supabase) {
    return router.createUrlTree(['/login']);
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    return router.createUrlTree(['/login']);
  }

  return true;
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },

  {
    path: 'login',
    component: AppRouteMarkerComponent,
    data: { screen: 'welcome' },
  },
  {
    path: 'dashboard',
    component: AppRouteMarkerComponent,
    canActivate: [requireAuth],
    data: { screen: 'home' },
  },
  {
    path: 'register',
    component: AppRouteMarkerComponent,
    canActivate: [requireAuth],
    data: { screen: 'register' },
  },
  {
    path: 'records',
    component: AppRouteMarkerComponent,
    canActivate: [requireAuth],
    data: { screen: 'records' },
  },
  {
    path: 'reports',
    component: AppRouteMarkerComponent,
    canActivate: [requireAuth],
    data: { screen: 'reports' },
  },
  {
    path: 'profile',
    component: AppRouteMarkerComponent,
    canActivate: [requireAuth],
    data: { screen: 'profile' },
  },
  { path: '**', redirectTo: 'login' },
];
