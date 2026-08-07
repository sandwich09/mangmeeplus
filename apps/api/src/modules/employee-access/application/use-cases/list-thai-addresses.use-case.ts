import { BadRequestException, Injectable } from '@nestjs/common';
import type { ThaiAddressOption } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';

@Injectable()
export class ListThaiAddressesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  execute(postalCode: string): Promise<ThaiAddressOption[]> {
    if (!/^\d{3,5}$/.test(postalCode)) throw new BadRequestException('postal_code_invalid');

    return this.prisma.client.thaiAddressMaster.findMany({
      where: { postalCode: { startsWith: postalCode } },
      select: {
        postalCode: true,
        provinceCode: true,
        provinceTh: true,
        districtCode: true,
        districtTh: true,
        subdistrictCode: true,
        subdistrictTh: true,
      },
      orderBy: [{ provinceTh: 'asc' }, { districtTh: 'asc' }, { subdistrictTh: 'asc' }],
    });
  }
}
