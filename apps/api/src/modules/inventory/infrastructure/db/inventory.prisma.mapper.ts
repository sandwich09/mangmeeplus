import type {
  Product as PrismaProduct,
  ProductBarcode as PrismaBarcode,
  InventoryLocation as PrismaLocation,
  InternalQrLabel as PrismaQrLabel,
  StockMovement as PrismaMovement,
} from '../../../../generated/prisma/client';
import type {
  Product,
  ProductBarcode,
  InventoryLocation,
  InternalQrLabel,
  StockMovement,
} from '../../domain/models/inventory.model';

export function toProduct(r: PrismaProduct): Product {
  return {
    id: r.id,
    companyId: r.companyId,
    sku: r.sku,
    name: r.name,
    description: r.description ?? undefined,
    category: r.category ?? undefined,
    unit: r.unit,
    kind: r.kind as Product['kind'],
    reorderPoint: r.reorderPoint != null ? r.reorderPoint.toString() : undefined,
    salePrice: r.salePrice != null ? r.salePrice.toString() : undefined,
    bookingDurationMinutes: r.bookingDurationMinutes ?? undefined,
    customerVisible: r.customerVisible,
    status: r.status as Product['status'],
    createdByUserId: r.createdByUserId,
    updatedByUserId: r.updatedByUserId ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toBarcode(r: PrismaBarcode): ProductBarcode {
  return {
    id: r.id,
    companyId: r.companyId,
    productId: r.productId,
    type: r.type as ProductBarcode['type'],
    value: r.value,
    source: r.source ?? undefined,
    status: r.status as ProductBarcode['status'],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toLocation(r: PrismaLocation): InventoryLocation {
  return {
    id: r.id,
    companyId: r.companyId,
    branchId: r.branchId ?? undefined,
    code: r.code,
    name: r.name,
    type: r.type as InventoryLocation['type'],
    status: r.status as InventoryLocation['status'],
    createdByUserId: r.createdByUserId,
    updatedByUserId: r.updatedByUserId ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toQrLabel(r: PrismaQrLabel): InternalQrLabel {
  return {
    id: r.id,
    companyId: r.companyId,
    entityType: r.entityType as InternalQrLabel['entityType'],
    entityId: r.entityId,
    payload: r.payload,
    labelText: r.labelText,
    status: r.status as InternalQrLabel['status'],
    printedAt: r.printedAt ?? undefined,
    printedByUserId: r.printedByUserId ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toMovement(r: PrismaMovement): StockMovement {
  return {
    id: r.id,
    companyId: r.companyId,
    movementNumber: r.movementNumber ?? undefined,
    productId: r.productId,
    locationId: r.locationId,
    movementType: r.movementType as StockMovement['movementType'],
    direction: r.direction as StockMovement['direction'],
    quantity: r.quantity.toString(),
    reason: r.reason ?? undefined,
    referenceType: r.referenceType ?? undefined,
    referenceId: r.referenceId ?? undefined,
    transferGroupId: r.transferGroupId ?? undefined,
    reversesMovementId: r.reversesMovementId ?? undefined,
    actorUserId: r.actorUserId,
    occurredAt: r.occurredAt,
    createdAt: r.createdAt,
  };
}
