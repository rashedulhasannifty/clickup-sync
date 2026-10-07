import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { AuditLogInterceptor } from "../admin/audit-log.interceptor";
import { AuthPrincipal, Role } from "../auth/auth.types";
import { CurrentUser, Roles } from "../auth/decorators";
import { AddEmploymentEventDto } from "./dto/add-employment-event.dto";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { ListEmployeesQuery } from "./dto/list-employees.query";
import { SummaryQuery } from "./dto/summary.query";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { EmployeesService } from "./employees.service";
import { PeopleSummaryService } from "./people-summary.service";
import type {
  DirectoryRow,
  EmployeeProfile,
  EmployeeSummary,
  EmploymentEventView,
  ImportFromUsersResult,
} from "./people.types";

/** Employee records, employment history and the employee summary. Owner/Admin only; writes are audited. */
@ApiTags("people")
@ApiSecurity("x-admin-key")
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller("people/employees")
export class PeopleEmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly summaries: PeopleSummaryService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "Employee directory: profile, today’s attendance state and the 90-day overall score",
  })
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: ListEmployeesQuery,
  ): Promise<DirectoryRow[]> {
    return this.summaries.directory(user.orgId, q);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Create an employee (writes the JOINED event)" })
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: CreateEmployeeDto,
  ): Promise<EmployeeProfile> {
    return this.employees.create(user, dto);
  }

  // Static path declared before the :id routes.
  @Post("import-from-users")
  @HttpCode(201)
  @ApiOperation({
    summary: "Create an employee for every active login that has none",
  })
  importFromUsers(
    @CurrentUser() user: AuthPrincipal,
  ): Promise<ImportFromUsersResult> {
    return this.employees.importFromUsers(user);
  }

  @Get(":id")
  @ApiOperation({ summary: "Employee profile" })
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
  ): Promise<EmployeeProfile> {
    return this.employees.getProfile(user.orgId, id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Edit profile fields (status moves through events, not here)",
  })
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeProfile> {
    return this.employees.update(user.orgId, id, dto);
  }

  @Get(":id/events")
  @ApiOperation({ summary: "Employment timeline, newest first" })
  events(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
  ): Promise<EmploymentEventView[]> {
    return this.employees.listEvents(user.orgId, id);
  }

  @Post(":id/events")
  @HttpCode(201)
  @ApiOperation({
    summary:
      "Add an employment event; promotions, confirmation, notice, exit and transfer update the employee",
  })
  addEvent(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @Body() dto: AddEmploymentEventDto,
  ): Promise<EmploymentEventView> {
    return this.employees.addEvent(user, id, dto);
  }

  @Get(":id/summary")
  @ApiOperation({
    summary:
      "Employee at a glance: KPIs, trend, attendance strip, leave balance, timeline",
  })
  summary(
    @CurrentUser() user: AuthPrincipal,
    @Param("id") id: string,
    @Query() q: SummaryQuery,
  ): Promise<EmployeeSummary> {
    return this.summaries.summary(user.orgId, id, q);
  }
}
