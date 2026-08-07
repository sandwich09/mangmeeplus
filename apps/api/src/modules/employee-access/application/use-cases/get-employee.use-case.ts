import { Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeDetail } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { EMPLOYEE_PROFILE_INCLUDE, toEmployeeSummary } from '../dto/employee-access.mapper';

@Injectable()
export class GetEmployeeUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string, employeeId: string): Promise<EmployeeDetail> {
    const row = await this.prisma.client.employeeAccessProfile.findFirst({
      where: { id: employeeId, companyId },
      include: EMPLOYEE_PROFILE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Employee not found');

    return toEmployeeSummary(row);
  }
}
