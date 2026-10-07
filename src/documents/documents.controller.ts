import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { MAX_UPLOAD_BYTES } from './document-catalog';
import { CompanyDocumentsQueryDto, ReplaceDocumentDto, UpdateDocumentDto, UploadDocumentDto } from './dto/documents.dto';
import { DocumentsEnabledGuard } from './documents-enabled.guard';
import { DocumentsService, type UploadedFileLike } from './documents.service';

/** Multer memory storage, hard-capped. Exceeding the cap is a 413 from the interceptor. */
const uploadInterceptor = () => FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } });

/**
 * Employee documents (People slice 2). Owner/Admin only; writes are audited; DELETE is Owner-only.
 * The bucket is private: bytes stream through here both ways, so every access is authenticated.
 */
@ApiTags('people')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseGuards(DocumentsEnabledGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('people')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('employees/:employeeId/documents')
  @ApiOperation({ summary: "An employee's current documents, with the required checklist" })
  listForEmployee(@CurrentUser() user: AuthPrincipal, @Param('employeeId') employeeId: string) {
    return this.documents.listForEmployee(user.orgId, employeeId);
  }

  @Post('employees/:employeeId/documents')
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(uploadInterceptor())
  @ApiOperation({ summary: 'Upload a document (multipart: file, category, docType, expiresOn?, visibility?)' })
  upload(
    @CurrentUser() user: AuthPrincipal,
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documents.upload(user, employeeId, file, dto);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Company-wide documents + counts; status=expiring|expired|missing' })
  listCompany(@CurrentUser() user: AuthPrincipal, @Query() q: CompanyDocumentsQueryDto) {
    return this.documents.listCompany(user.orgId, q);
  }

  @Get('documents/:id/content')
  @ApiOperation({ summary: 'Stream the file. PDFs and raster images inline; everything else (or download=1) downloads' })
  async content(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.documents.content(user.orgId, id, download === '1' || download === 'true');
    res.set(file.headers);
    return new StreamableFile(file.stream);
  }

  @Patch('documents/:id')
  @ApiOperation({ summary: 'Change category, document type, expiry or visibility' })
  update(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) {
    return this.documents.update(user.orgId, id, dto);
  }

  @Post('documents/:id/replace')
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(uploadInterceptor())
  @ApiOperation({ summary: 'Upload a new version (multipart: file, expiresOn?). The old version is kept' })
  replace(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: ReplaceDocumentDto,
  ) {
    return this.documents.replace(user, id, file, dto);
  }

  @Delete('documents/:id')
  @Roles(Role.OWNER)
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a document and its older versions (Owner only). Objects are kept' })
  async remove(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.documents.remove(user.orgId, id);
  }
}
