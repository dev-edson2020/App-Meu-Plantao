import { Component, inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { getSupabase } from './core/supabase-client';
@Component({selector:'app-route-marker',standalone:true,template:''}) export class AppRouteMarkerComponent {}
const requireAuth: CanActivateFn = async () => {
  const router = inject(Router);
  try {
    const supabase = await getSupabase();
    if (!supabase) return router.createUrlTree(['/login']);
    const { data, error } = await supabase.auth.getSession();
    return error || !data.session ? router.createUrlTree(['/login']) : true;
  } catch {
    return router.createUrlTree(['/login']);
  }
};
export const routes: Routes=[{path:'',pathMatch:'full',redirectTo:'login'},{path:'login',component:AppRouteMarkerComponent},{path:'dashboard',component:AppRouteMarkerComponent,canActivate:[requireAuth]},{path:'register',component:AppRouteMarkerComponent,canActivate:[requireAuth]},{path:'records',component:AppRouteMarkerComponent,canActivate:[requireAuth]},{path:'reports',component:AppRouteMarkerComponent,canActivate:[requireAuth]},{path:'profile',component:AppRouteMarkerComponent,canActivate:[requireAuth]},{path:'**',redirectTo:'login'}];
