import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AssignShiftsDto,
  CreateShiftDto,
  ShiftSuggestionsQuery,
  UpdateShiftDto,
} from './dto/shift.dto';
import {
  addDays,
  dateColumnToIso,
  dhakaDateOf,
  dhakaMinutesOfDay,
  isBusinessDay,
} from './people-dates';
import { formatMinutes, shiftLengthMinutes } from './shift-math';
import { suggestShifts, type ShiftSuggestion } from './shift-suggestions';
import { ShiftsRepository } from './shifts.repository';

export interface ShiftView {
  id: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  graceMinutes: number;
  trackPunctuality: boolean;
  /** `HH:MM` labels. */
  start: string;
  end: string;
  /** Expected hours per working day (the shift length). */
  lengthHours: number;
  /** Employees currently on this shift. */
  assignedCount: number;
}

export interface ShiftSuggestions {
  period: { from: string; to: string };
  suggestions: ShiftSuggestion[];
}

const SUGGEST_DEFAULT_DAYS = 90;
const SUGGEST_MAX_DAYS = 400;

type ShiftRow = Awaited<ReturnType<ShiftsRepository['list']>>[number];

export function toShiftView(s: ShiftRow): ShiftView {
  return {
    id: s.id,
    name: s.name,
    startMinutes: s.startMinutes,
    endMinutes: s.endMinutes,
    graceMinutes: s.graceMinutes,
    trackPunctuality: s.trackPunctuality,
    start: formatMinutes(s.startMinutes),
    end: formatMinutes(s.endMinutes),
    lengthHours:
      Math.round((shiftLengthMinutes(s.startMinutes, s.endMinutes) / 60) * 100) /
      100,
    assignedCount: s._count.employees,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'
  );
}

/** Work shifts (0036): CRUD, bulk assignment, and suggestions from imported attendance. */
@Injectable()
export class ShiftsService {
  constructor(private readonly repo: ShiftsRepository) {}

  async list(orgId: string): Promise<ShiftView[]> {
    return (await this.repo.list(orgId)).map(toShiftView);
  }

  async create(orgId: string, dto: CreateShiftDto): Promise<ShiftView> {
    if (dto.startMinutes === dto.endMinutes)
      throw new BadRequestException('A shift must end at a different time than it starts');
    try {
      return toShiftView(
        await this.repo.create(orgId, { ...dto, name: dto.name.trim() }),
      );
    } catch (e) {
      throw this.translate(e);
    }
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateShiftDto,
  ): Promise<ShiftView> {
    const current = await this.require(orgId, id);
    const start = dto.startMinutes ?? current.startMinutes;
    const end = dto.endMinutes ?? current.endMinutes;
    if (start === end)
      throw new BadRequestException('A shift must end at a different time than it starts');
    try {
      return toShiftView(
        await this.repo.update(id, {
          ...dto,
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        }),
      );
    } catch (e) {
      throw this.translate(e);
    }
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.require(orgId, id);
    await this.repo.delete(id);
  }

  /** Accept suggestions (one or all) or set shifts by hand. All ids must be this org's. */
  async assign(
    orgId: string,
    dto: AssignShiftsDto,
  ): Promise<{ updated: number }> {
    const employeeIds = [...new Set(dto.assignments.map((a) => a.employeeId))];
    if (employeeIds.length !== dto.assignments.length)
      throw new BadRequestException('Each employee may appear only once');
    if ((await this.repo.countEmployeesInOrg(orgId, employeeIds)) !== employeeIds.length)
      throw new BadRequestException('Unknown employee');
    const shiftIds = new Set((await this.repo.list(orgId)).map((s) => s.id));
    for (const a of dto.assignments)
      if (a.shiftId && !shiftIds.has(a.shiftId))
        throw new BadRequestException('Unknown shift');
    const updated = await this.repo.assign(
      orgId,
      dto.assignments.map((a) => ({
        employeeId: a.employeeId,
        shiftId: a.shiftId ?? null,
      })),
    );
    return { updated };
  }

  /** Proposals only: the median real first-in per employee against the nearest shift start. */
  async suggestions(
    orgId: string,
    q: ShiftSuggestionsQuery,
  ): Promise<ShiftSuggestions> {
    const to = q.to ?? dhakaDateOf(new Date());
    const from = q.from ?? addDays(to, -(SUGGEST_DEFAULT_DAYS - 1));
    if (from > to)
      throw new BadRequestException('`from` must be on or before `to`');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > SUGGEST_MAX_DAYS)
      throw new BadRequestException(
        `The period cannot exceed ${SUGGEST_MAX_DAYS} days`,
      );
    const [shifts, employees] = await Promise.all([
      this.repo.list(orgId),
      this.repo.employeesWithRealFirstIns(orgId, from, to),
    ]);
    return {
      period: { from, to },
      suggestions: suggestShifts(
        employees.map((e) => ({
          id: e.id,
          fullName: e.fullName,
          shiftId: e.shiftId,
          // Weekend work is extra, not the shift: only business days count.
          firstIns: e.attendances
            .filter((a) => a.firstIn && isBusinessDay(dateColumnToIso(a.date)))
            .map((a) => dhakaMinutesOfDay(a.firstIn as Date)),
        })),
        shifts,
      ),
    };
  }

  private async require(orgId: string, id: string): Promise<ShiftRow> {
    const row = await this.repo.find(orgId, id);
    if (!row) throw new NotFoundException('Shift not found');
    return row;
  }

  private translate(e: unknown): Error {
    if (isUniqueViolation(e))
      return new ConflictException('A shift with this name already exists');
    return e as Error;
  }
}
