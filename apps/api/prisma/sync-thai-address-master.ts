import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
const prisma = new PrismaClient({ adapter });
const BATCH_SIZE = 500;

const UPSERT_SQL = `
INSERT INTO "ThaiAddressMaster" (
  "postalCode", "subdistrictTh", "districtTh", "provinceTh",
  "subdistrictEn", "districtEn", "provinceEn", "subdistrictCode",
  "districtCode", "provinceCode", "subdistrictId", "districtId",
  "provinceId", "latitude", "longitude", "sourceUpdatedAt", "updatedAt"
)
SELECT
  x."postalCode", x."subdistrictTh", x."districtTh", x."provinceTh",
  x."subdistrictEn", x."districtEn", x."provinceEn", x."subdistrictCode",
  x."districtCode", x."provinceCode", x."subdistrictId", x."districtId",
  x."provinceId", x."latitude", x."longitude", x."sourceUpdatedAt", CURRENT_TIMESTAMP
FROM jsonb_to_recordset($1::jsonb) AS x(
  "postalCode" text, "subdistrictTh" text, "districtTh" text, "provinceTh" text,
  "subdistrictEn" text, "districtEn" text, "provinceEn" text, "subdistrictCode" text,
  "districtCode" text, "provinceCode" text, "subdistrictId" integer, "districtId" integer,
  "provinceId" integer, "latitude" decimal(10,7), "longitude" decimal(10,7), "sourceUpdatedAt" timestamp(3)
)
ON CONFLICT ("subdistrictCode") DO UPDATE SET
  "postalCode" = EXCLUDED."postalCode",
  "subdistrictTh" = EXCLUDED."subdistrictTh",
  "districtTh" = EXCLUDED."districtTh",
  "provinceTh" = EXCLUDED."provinceTh",
  "subdistrictEn" = EXCLUDED."subdistrictEn",
  "districtEn" = EXCLUDED."districtEn",
  "provinceEn" = EXCLUDED."provinceEn",
  "districtCode" = EXCLUDED."districtCode",
  "provinceCode" = EXCLUDED."provinceCode",
  "subdistrictId" = EXCLUDED."subdistrictId",
  "districtId" = EXCLUDED."districtId",
  "provinceId" = EXCLUDED."provinceId",
  "latitude" = EXCLUDED."latitude",
  "longitude" = EXCLUDED."longitude",
  "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt",
  "updatedAt" = CURRENT_TIMESTAMP
`;

async function main() {
  const file = join(__dirname, 'data', 'thai-address-master.jsonl');
  const rows = (await readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    await prisma.$executeRawUnsafe(UPSERT_SQL, JSON.stringify(rows.slice(offset, offset + BATCH_SIZE)));
  }

  const count = await prisma.thaiAddressMaster.count();
  if (count < rows.length) throw new Error(`Thai Address Master verification failed: expected at least ${rows.length}, found ${count}.`);
  console.log(`Thai Address Master sync complete: ${rows.length} source rows, ${count} database rows.`);
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(() => prisma.$disconnect());
