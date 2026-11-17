import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class FormValidationService {

  focusFirstInvalidField(container: HTMLElement): boolean {
    const invalidField = container.querySelector<HTMLElement>(
      'input.ng-invalid:not([type="hidden"]), select.ng-invalid, textarea.ng-invalid'
    );

    if (!invalidField) {
      return true;
    }

    invalidField.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });

    setTimeout(() => {
      invalidField.focus();
    }, 350);

    return false;
  }
}