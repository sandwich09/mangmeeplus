import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ListThaiAddressesUseCase } from './list-thai-addresses.use-case';

describe('ListThaiAddressesUseCase', () => {
  it('searches canonical address rows by a three-to-five-digit postal prefix', async () => {
    let query: unknown;
    const rows = [{
      postalCode: '10110', provinceCode: '10', provinceTh: 'กรุงเทพมหานคร',
      districtCode: '1039', districtTh: 'วัฒนา', subdistrictCode: '103901', subdistrictTh: 'คลองเตยเหนือ',
    }];
    const prisma = {
      client: { thaiAddressMaster: { findMany: async (args: unknown) => { query = args; return rows; } } },
    } as any;
    const useCase = new ListThaiAddressesUseCase(prisma);

    await assert.rejects(async () => useCase.execute('10'), /postal_code_invalid/);
    assert.deepEqual(await useCase.execute('101'), rows);
    assert.deepEqual(query, {
      where: { postalCode: { startsWith: '101' } },
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
  });
});
