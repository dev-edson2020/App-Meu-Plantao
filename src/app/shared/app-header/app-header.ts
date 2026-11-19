
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-header',
  standalone: true,
  templateUrl: './app-header.html',
  styleUrl: './app-header.scss',
})
export class AppHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() home = false;
}
