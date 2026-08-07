CREATE TABLE "ThaiAddressMaster" (
    "subdistrictCode" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "subdistrictTh" TEXT NOT NULL,
    "districtTh" TEXT NOT NULL,
    "provinceTh" TEXT NOT NULL,
    "subdistrictEn" TEXT,
    "districtEn" TEXT,
    "provinceEn" TEXT,
    "districtCode" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "subdistrictId" INTEGER,
    "districtId" INTEGER,
    "provinceId" INTEGER,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "sourceUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThaiAddressMaster_pkey" PRIMARY KEY ("subdistrictCode")
);

CREATE INDEX "ThaiAddressMaster_postalCode_idx" ON "ThaiAddressMaster"("postalCode");
CREATE INDEX "ThaiAddressMaster_provinceCode_districtCode_idx" ON "ThaiAddressMaster"("provinceCode", "districtCode");
CREATE INDEX "ThaiAddressMaster_provinceTh_districtTh_subdistrictTh_idx" ON "ThaiAddressMaster"("provinceTh", "districtTh", "subdistrictTh");
