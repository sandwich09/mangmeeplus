import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';

// Infrastructure
import { PrismaProductRepository } from './infrastructure/repositories/prisma-product.repository';
import { PrismaBarcodeRepository } from './infrastructure/repositories/prisma-barcode.repository';
import { PrismaLocationRepository } from './infrastructure/repositories/prisma-location.repository';
import { PrismaMovementRepository } from './infrastructure/repositories/prisma-movement.repository';
import { PrismaQrLabelRepository } from './infrastructure/repositories/prisma-qrlabel.repository';
import { PrismaBalanceQuery } from './infrastructure/queries/balance.query';

// Use Cases
import { CreateProductUseCase } from './application/use-cases/create-product.use-case';
import { ListProductsUseCase, GetProductUseCase } from './application/use-cases/list-products.use-case';
import { UpdateProductUseCase, ArchiveProductUseCase } from './application/use-cases/update-product.use-case';
import { ListLocationsUseCase, GetLocationUseCase, CreateLocationUseCase, UpdateLocationUseCase, ArchiveLocationUseCase } from './application/use-cases/location.use-cases';
import { CreateMovementUseCase } from './application/use-cases/create-movement.use-case';
import { TransferStockUseCase } from './application/use-cases/transfer-stock.use-case';
import { StockCountUseCase } from './application/use-cases/stock-count.use-case';
import { AddProductBarcodeUseCase } from './application/use-cases/barcode.use-cases';
import { ListMovementsUseCase, GetStockBalanceUseCase, GetStockReportUseCase } from './application/use-cases/movement-query.use-cases';
import { GenerateQrLabelUseCase, ResolveQrScanUseCase, MarkQrLabelPrintedUseCase, ListQrLabelsUseCase } from './application/use-cases/qr-label.use-cases';

// Controllers
import { InventoryProductController } from './presentation/http/inventory-product.controller';
import { InventoryLocationController } from './presentation/http/inventory-location.controller';
import { InventoryMovementController } from './presentation/http/inventory-movement.controller';
import { InventoryQrController } from './presentation/http/inventory-qr.controller';

const repositories = [
  PrismaProductRepository,
  PrismaBarcodeRepository,
  PrismaLocationRepository,
  PrismaMovementRepository,
  PrismaQrLabelRepository,
  PrismaBalanceQuery,
];

const useCases = [
  CreateProductUseCase,
  ListProductsUseCase,
  GetProductUseCase,
  UpdateProductUseCase,
  ArchiveProductUseCase,
  ListLocationsUseCase,
  GetLocationUseCase,
  CreateLocationUseCase,
  UpdateLocationUseCase,
  ArchiveLocationUseCase,
  CreateMovementUseCase,
  TransferStockUseCase,
  StockCountUseCase,
  AddProductBarcodeUseCase,
  ListMovementsUseCase,
  GetStockBalanceUseCase,
  GetStockReportUseCase,
  GenerateQrLabelUseCase,
  ResolveQrScanUseCase,
  MarkQrLabelPrintedUseCase,
  ListQrLabelsUseCase,
];

@Module({
  imports: [AuditModule, DataModelCoreModule],
  controllers: [
    InventoryProductController,
    InventoryLocationController,
    InventoryMovementController,
    InventoryQrController,
  ],
  providers: [...repositories, ...useCases],
  exports: [
    ListProductsUseCase,
    GetProductUseCase,
    ListMovementsUseCase,
    GetStockBalanceUseCase,
    GetStockReportUseCase,
    CreateMovementUseCase,
  ],
})
export class InventoryModule {}
