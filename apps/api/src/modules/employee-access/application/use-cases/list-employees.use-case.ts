import { Injectable } from '@nestjs/common';
import type { EmployeeSummary } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { EMPLOYEE_PROFILE_INCLUDE, toEmployeeSummary } from '../dto/employee-access.mapper';

@Injectable()
export class ListEmployeesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string): Promise<EmployeeSummary[]> {
    const rows = await this.prisma.client.employeeAccessProfile.findMany({
      where: { companyId },
      include: EMPLOYEE_PROFILE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => toEmployeeSummary(row));
  }
}
