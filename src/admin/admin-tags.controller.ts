import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { CreateTagAssigneeDto } from './dto/create-tag-assignee.dto';
import { UpdateTagAssigneeDto } from './dto/update-tag-assignee.dto';
import { TagAssigneeMapRepository } from '../time-entries/tag-assignee-map.repository';
import { parseId } from './admin.util';

/** Tag → assignee mapping CRUD under `/admin`. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminTagsController {
  constructor(private readonly tagAssigneeRepo: TagAssigneeMapRepository) {}

  @Get('tag-assignee-map')
  @ApiOperation({ summary: 'List all tag → assignee mappings' })
  listTagAssignee() {
    return this.tagAssigneeRepo.findAll();
  }

  @Post('tag-assignee-map')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a tag → assignee mapping' })
  createTagAssignee(@Body() dto: CreateTagAssigneeDto) {
    return this.tagAssigneeRepo.create({ tagName: dto.tagName, clickupUserId: dto.clickupUserId, clickupUserName: dto.clickupUserName, clickupEmail: dto.clickupEmail, active: dto.active });
  }

  @Patch('tag-assignee-map/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a tag → assignee mapping' })
  async updateTagAssignee(@Param('id') id: string, @Body() dto: UpdateTagAssigneeDto) {
    try {
      return await this.tagAssigneeRepo.update(parseId(id), dto);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException(`A tag named "${dto.tagName}" already exists.`);
      }
      throw e;
    }
  }

  @Delete('tag-assignee-map/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a tag → assignee mapping' })
  deleteTagAssignee(@Param('id') id: string) {
    return this.tagAssigneeRepo.remove(parseId(id));
  }
}
