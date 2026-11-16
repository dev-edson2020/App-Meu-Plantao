
import { Component, inject } from '@angular/core';
import { ToastService } from '../../core/toast';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [],
  templateUrl: './toast.html',
  styleUrl: './toast.scss'
})
export class ToastComponent {
  protected readonly toastService = inject(ToastService);
}
