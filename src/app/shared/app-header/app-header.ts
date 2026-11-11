import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LucideArrowLeft, LucideLogOut } from '@lucide/angular';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [LucideArrowLeft, LucideLogOut],
  templateUrl: './app-header.html',
  styleUrl: './app-header.scss',
})
export class AppHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() home = false;
  @Output() backClick = new EventEmitter<void>();
  @Output() exitClick = new EventEmitter<void>();
}
