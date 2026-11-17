import { ChangeDetectorRef, Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { AppState } from '../../core/app-state.service';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldErrorComponent } from '../../shared/field-error/field-error';
import { LucideCamera, LucideCheck, LucideImage, LucidePencil, LucideX } from '@lucide/angular';
@Component({ selector: 'app-register', standalone: true, imports: [FormsModule, DatePipe, FieldErrorComponent, LucideCamera, LucideCheck, LucideImage, LucidePencil, LucideX], templateUrl: './register.html', styleUrl: './register.scss' })
export class RegisterComponent {
 readonly vm = inject(AppState);
 readonly photoError = signal('');
 readonly cameraOpen = signal(false);
 readonly cameraError = signal('');
 private readonly cdr = inject(ChangeDetectorRef);
 private readonly destroyRef = inject(DestroyRef);
 private cameraStream: MediaStream | null = null;
 private destroyed = false;
 @ViewChild('cameraVideo') private cameraVideo?: ElementRef<HTMLVideoElement>;

 constructor() {
  this.destroyRef.onDestroy(() => {
   this.destroyed = true;
   this.stopCamera();
  });
 }

 async openCamera(): Promise<void> {
  this.vm.captureCurrentAction();
  this.cameraError.set('');
  this.photoError.set('');

  if (!navigator.mediaDevices?.getUserMedia) {
   this.cameraError.set('Este navegador não disponibiliza acesso à câmera.');
   return;
  }

  this.stopCamera();
  this.cameraOpen.set(true);

  try {
   let stream: MediaStream;
   try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
   } catch (error) {
    if (!this.isFacingModeUnsupported(error)) throw error;
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
   }

   if (this.destroyed || !this.cameraOpen()) {
    stream.getTracks().forEach(track => track.stop());
    return;
   }

   this.cameraStream = stream;
   this.cdr.detectChanges();
   const video = this.cameraVideo?.nativeElement;
   if (!video) throw new Error('O visualizador da câmera não ficou disponível.');
   video.srcObject = stream;
   await video.play();
  } catch (error) {
   this.stopCamera();
   this.cameraOpen.set(false);
   this.cameraError.set(this.cameraErrorMessage(error));
  }
 }

 async takePhoto(): Promise<void> {
  const video = this.cameraVideo?.nativeElement;
  if (!video || !video.videoWidth || !video.videoHeight) {
   this.cameraError.set('A câmera ainda está iniciando. Tente novamente em instantes.');
   return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) {
   this.cameraError.set('Não foi possível preparar a imagem capturada.');
   return;
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) {
   this.cameraError.set('Não foi possível gerar o arquivo da fotografia.');
   return;
  }

  if (this.destroyed) return;
  this.vm.setPhotoFile(new File([blob], `registro-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
  this.cdr.detectChanges();
  this.photoError.set('');
  this.cameraError.set('');
  this.closeCamera();
 }

 closeCamera(): void {
  this.cameraOpen.set(false);
  this.stopCamera();
 }

 photoChanged(event: Event): void {
  this.closeCamera();
  this.vm.handlePhoto(event);
  if (this.vm.selectedPhoto) this.photoError.set('');
 }

 removePhoto(galleryInput: HTMLInputElement): void {
  this.closeCamera();
  this.vm.clearPhoto(galleryInput);
 }

 async save(): Promise<void> { this.photoError.set(''); if (!this.vm.capturedAt()) return; if (!this.vm.selectedPhoto) { this.photoError.set('Adicione uma fotografia para continuar.'); return; } await this.vm.saveRecord(); }

 private stopCamera(): void {
  if (this.cameraStream) {
   this.cameraStream.getTracks().forEach(track => track.stop());
   this.cameraStream = null;
  }
  const video = this.cameraVideo?.nativeElement;
  if (video) video.srcObject = null;
 }

 private isFacingModeUnsupported(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'TypeError';
 }

 private cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Permissão para usar a câmera negada. Autorize a câmera nas configurações do navegador e tente novamente.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Nenhuma câmera foi encontrada neste dispositivo.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'A câmera está ocupada ou não pôde ser iniciada. Feche outros aplicativos que estejam usando a câmera e tente novamente.';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'Não foi encontrada uma câmera compatível com este modo.';
  return 'Não foi possível iniciar a câmera. Verifique a conexão da webcam e tente novamente.';
 }
}
