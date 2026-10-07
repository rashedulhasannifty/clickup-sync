import { CanActivate, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DOCUMENT_STORAGE, type DocumentStorage } from './document-storage';

/**
 * Answers 503 on every documents route when storage is not configured. A guard, not a check in
 * the handler: guards run before interceptors, so an upload to a disabled feature is refused
 * before multer buffers up to 20 MB of it.
 */
@Injectable()
export class DocumentsEnabledGuard implements CanActivate {
  constructor(@Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage) {}

  canActivate(): boolean {
    if (!this.storage.enabled) {
      throw new ServiceUnavailableException('Employee documents are not configured on this server.');
    }
    return true;
  }
}
