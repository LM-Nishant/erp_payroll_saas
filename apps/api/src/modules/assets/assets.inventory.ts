import type { Prisma } from '@prisma/client';
import type {
  CreateInventoryItemInput,
  InventoryTransactionInput,
  ListInventoryItemsQuery,
  UpdateInventoryItemInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  currentPrincipal,
  hierarchyResource,
  scopeWhere,
} from '../../core/authz';
import { isUniqueViolation } from '../../core/db/helpers';
import { emit } from '../../core/events';
import {
  AppError,
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { round2, todayUtc } from './assets.logic';
import { num, toDate, toInventoryItemDto, toInventoryTxnDto } from './assets.mappers';
import { holders, notifyUsers } from './assets.notify';
import { resolvePlacement } from './assets.service';

const isLow = (i: { quantity: Prisma.Decimal; reorderLevel: Prisma.Decimal }) =>
  num(i.reorderLevel) > 0 && num(i.quantity) <= num(i.reorderLevel);

async function loadItem(id: string, permission?: string) {
  const item = await tenantDb().inventoryItem.findUnique({ where: { id } });
  const principal = currentPrincipal();
  if (!item || !(await can(principal, 'asset.view', hierarchyResource.asset(item))))
    throw new NotFoundError('Inventory item');
  if (permission) await authorize(principal, permission, hierarchyResource.asset(item));
  return item;
}

/** Notify stock managers once when an item crosses its reorder level. */
export async function alertLowStock(item: {
  id: string;
  name: string;
  sku: string;
  unit: string;
  quantity: Prisma.Decimal;
  reorderLevel: Prisma.Decimal;
  groupId: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string | null;
}) {
  await notifyUsers(
    'asset.inventory_low',
    await holders('asset.manage', hierarchyResource.asset(item)),
    {
      title: `Low stock: ${item.name} (${item.sku})`,
      body: `${num(item.quantity)} ${item.unit} left; reorder level ${num(item.reorderLevel)}.`,
      link: '/assets/inventory?lowStock=true',
      institutionId: item.institutionId,
      data: { itemId: item.id },
    },
  );
  await tenantDb().inventoryItem.update({
    where: { id: item.id },
    data: { lastAlertAt: new Date() },
  });
  await emit(
    'asset.inventory_low',
    { itemId: item.id, sku: item.sku, quantity: num(item.quantity) },
    { institutionId: item.institutionId },
  );
}

export const inventoryService = {
  async list(query: ListInventoryItemsQuery) {
    const where = andScope<Prisma.InventoryItemWhereInput>(
      {
        institutionId: query.institutionId,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search } },
                { sku: { contains: query.search } },
                { category: { contains: query.search } },
              ],
            }
          : {}),
      },
      await scopeWhere(currentPrincipal(), 'asset.view', 'asset'),
    );
    const db = tenantDb();
    if (query.lowStock !== undefined) {
      // Column-to-column comparison is not expressible in Prisma's where; filter in memory.
      const all = await db.inventoryItem.findMany({ where, orderBy: [{ name: 'asc' }] });
      const filtered = all.filter((i) => isLow(i) === (query.lowStock === 'true'));
      const { skip, take } = toPageWindow(query);
      return {
        items: filtered.slice(skip, skip + take).map(toInventoryItemDto),
        total: filtered.length,
      };
    }
    const { skip, take } = toPageWindow(query);
    const [items, total] = await Promise.all([
      db.inventoryItem.findMany({ where, orderBy: [{ name: 'asc' }], skip, take }),
      db.inventoryItem.count({ where }),
    ]);
    return { items: items.map(toInventoryItemDto), total };
  },

  async get(id: string) {
    return toInventoryItemDto(await loadItem(id));
  },

  async create(input: CreateInventoryItemInput) {
    const placement = await resolvePlacement(
      input.institutionId,
      input.campusId,
      input.departmentId,
    );
    await authorize(currentPrincipal(), 'asset.manage', placement);
    const db = tenantDb();
    let created;
    try {
      created = await db.$transaction(async (tx) => {
        const item = await tx.inventoryItem.create({
          data: withTenant({
            ...placement,
            sku: input.sku.toUpperCase(),
            name: input.name,
            category: input.category ?? null,
            unit: input.unit,
            quantity: input.openingQuantity,
            reorderLevel: input.reorderLevel,
            unitCost: input.unitCost ?? null,
            location: input.location ?? null,
            notes: input.notes ?? null,
          }),
        });
        if (input.openingQuantity > 0) {
          await tx.inventoryTransaction.create({
            data: withTenant({
              itemId: item.id,
              groupId: item.groupId,
              institutionId: item.institutionId,
              campusId: item.campusId,
              departmentId: item.departmentId,
              type: 'IN',
              quantity: input.openingQuantity,
              balanceAfter: input.openingQuantity,
              unitCost: input.unitCost ?? null,
              date: todayUtc(),
              reference: 'Opening stock',
              createdByUserId: currentPrincipal().userId,
            }),
          });
        }
        return item;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError(`SKU ${input.sku} already exists`);
      throw err;
    }
    await audit.record({
      action: 'inventory_item.created',
      entityType: 'inventory_item',
      entityId: created.id,
      after: toInventoryItemDto(created),
    });
    return toInventoryItemDto(created);
  },

  async update(id: string, input: UpdateInventoryItemInput) {
    const before = await loadItem(id, 'asset.manage');
    const placement =
      input.campusId !== undefined || input.departmentId !== undefined
        ? await resolvePlacement(
            before.institutionId,
            input.campusId === undefined ? before.campusId : input.campusId,
            input.departmentId === undefined ? before.departmentId : input.departmentId,
          )
        : null;
    const updated = await tenantDb().inventoryItem.update({
      where: { id },
      data: {
        name: input.name,
        category: input.category,
        unit: input.unit,
        reorderLevel: input.reorderLevel,
        unitCost: input.unitCost,
        location: input.location,
        notes: input.notes,
        ...(placement
          ? { campusId: placement.campusId, departmentId: placement.departmentId }
          : {}),
      },
    });
    await audit.record({
      action: 'inventory_item.updated',
      entityType: 'inventory_item',
      entityId: id,
      before: toInventoryItemDto(before),
      after: toInventoryItemDto(updated),
    });
    return toInventoryItemDto(updated);
  },

  async remove(id: string) {
    const before = await loadItem(id, 'asset.manage');
    await tenantDb().inventoryItem.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'inventory_item.deleted',
      entityType: 'inventory_item',
      entityId: id,
      before: toInventoryItemDto(before),
    });
  },

  async transactions(id: string, query: { page: number; pageSize: number }) {
    await loadItem(id);
    const { skip, take } = toPageWindow(query);
    const db = tenantDb();
    const where = { itemId: id };
    const [items, total] = await Promise.all([
      db.inventoryTransaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      db.inventoryTransaction.count({ where }),
    ]);
    return { items: items.map(toInventoryTxnDto), total };
  },

  /** Stock in / out / adjust (ADJUST: `quantity` is the counted balance). */
  async transact(id: string, input: InventoryTransactionInput) {
    const before = await loadItem(id, 'asset.manage');
    const db = tenantDb();
    if (input.issuedToEmployeeId) {
      const emp = await db.employee.findUnique({ where: { id: input.issuedToEmployeeId } });
      if (!emp) throw new InvalidReferenceError('issuedToEmployeeId', 'Employee');
    }
    if (input.type !== 'ADJUST' && input.quantity <= 0)
      throw new AppError(422, 'INVALID_QUANTITY', 'Quantity must be greater than zero');
    const { item, txn } = await db.$transaction(async (tx) => {
      const current = await tx.inventoryItem.findUnique({ where: { id } });
      if (!current) throw new NotFoundError('Inventory item');
      const qty = num(current.quantity);
      const balance = round2(
        input.type === 'IN'
          ? qty + input.quantity
          : input.type === 'OUT'
            ? qty - input.quantity
            : input.quantity,
      );
      if (balance < 0)
        throw new AppError(
          409,
          'INSUFFICIENT_STOCK',
          `Only ${qty} ${current.unit} of ${current.name} in stock`,
        );
      const delta = input.type === 'ADJUST' ? round2(balance - qty) : input.quantity;
      const updatedItem = await tx.inventoryItem.update({
        where: { id },
        data: {
          quantity: balance,
          ...(input.type === 'IN' && input.unitCost != null ? { unitCost: input.unitCost } : {}),
          ...(balance > num(current.reorderLevel) ? { lastAlertAt: null } : {}),
        },
      });
      const row = await tx.inventoryTransaction.create({
        data: withTenant({
          itemId: id,
          groupId: current.groupId,
          institutionId: current.institutionId,
          campusId: current.campusId,
          departmentId: current.departmentId,
          type: input.type,
          quantity: delta,
          balanceAfter: balance,
          unitCost: input.unitCost ?? null,
          date: input.date ? toDate(input.date) : todayUtc(),
          reference: input.reference ?? null,
          issuedToEmployeeId: input.issuedToEmployeeId ?? null,
          notes: input.notes ?? null,
          createdByUserId: currentPrincipal().userId,
        }),
      });
      return { item: updatedItem, txn: row };
    });
    await audit.record({
      action: `inventory_item.stock_${input.type.toLowerCase()}`,
      entityType: 'inventory_item',
      entityId: id,
      before: { quantity: num(before.quantity) },
      after: { quantity: num(item.quantity), transactionId: txn.id },
    });
    if (isLow(item) && !isLow(before)) await alertLowStock(item);
    return { item: toInventoryItemDto(item), transaction: toInventoryTxnDto(txn) };
  },
};
