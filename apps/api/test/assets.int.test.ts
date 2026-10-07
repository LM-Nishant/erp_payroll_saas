import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db/prisma';
import { provisionOrganizationSubscription, syncPlanCatalog } from '../src/core/features';
import { asTenant, hasTestDatabase } from './helpers';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasTestDatabase)('asset management', () => {
  const app = createApp();
  const t = asTenant(app, 'assets-org');
  const other = asTenant(app, 'assets-other-org');
  const run = Date.now().toString(36).toUpperCase();

  beforeAll(async () => {
    await syncPlanCatalog();
    for (const slug of ['assets-org', 'assets-other-org']) {
      const org = await prisma.organization.upsert({
        where: { slug },
        create: { slug, name: slug },
        update: {},
      });
      await provisionOrganizationSubscription(org.id, 'enterprise');
    }
  });
  afterAll(() => prisma.$disconnect());

  async function setup() {
    const group = (
      await t.post('/api/v1/groups', { name: `Asset Group ${run}`, code: `AG${run}` }).expect(201)
    ).body.data;
    const institution = (
      await t
        .post('/api/v1/institutions', {
          groupId: group.id,
          name: `Logic Co ${run}`,
          code: `LC${run}`,
          type: 'COMPANY',
        })
        .expect(201)
    ).body.data;
    const category = (
      await t
        .post('/api/v1/assets/categories', {
          institutionId: institution.id,
          code: 'LAPTOP',
          name: 'Laptops',
          kind: 'IT',
          depreciationMethod: 'SLM',
          usefulLifeYears: 3,
          residualPercent: 5,
          tagPrefix: 'LT-',
          tagPadding: 4,
          attributes: [{ key: 'ram', label: 'RAM (GB)', type: 'number' }],
        })
        .expect(201)
    ).body.data;
    const employee = (
      await t
        .post('/api/v1/employees', {
          institutionId: institution.id,
          employmentType: 'NON_TEACHING',
          firstName: 'Asha',
          lastName: 'Rao',
          dateOfJoining: '2024-01-15',
          status: 'ACTIVE',
        })
        .expect(201)
    ).body.data;
    return { institution, category, employee };
  }

  it('runs the asset lifecycle: tagging, custody, exit checklist, maintenance, audit, disposal, inventory', async () => {
    const { institution, category, employee } = await setup();

    const create = (name: string, extra: object = {}) =>
      t
        .post('/api/v1/assets', {
          institutionId: institution.id,
          categoryId: category.id,
          name,
          make: 'Dell',
          model: 'Latitude 5440',
          purchaseDate: '2025-04-01',
          purchaseCost: 90000,
          warrantyExpiry: addDays(today(), 10),
          attributes: { ram: 16 },
          ...extra,
        })
        .expect(201);
    const laptop = (await create('Laptop 1', { serialNo: `SN-${run}-1` })).body.data;
    const spare = (await create('Laptop 2')).body.data;
    expect(laptop.assetTag).toBe('LT-0001');
    expect(spare.assetTag).toBe('LT-0002');
    expect(laptop.status).toBe('IN_STOCK');

    const listed = (await t.get(`/api/v1/assets?categoryId=${category.id}`).expect(200)).body;
    expect(listed.meta.total).toBe(2);
    const expiring = (
      await t
        .get(`/api/v1/assets?institutionId=${institution.id}&expiringWithinDays=30`)
        .expect(200)
    ).body;
    expect(expiring.meta.total).toBe(2);

    // Depreciation schedule (SLM, 3 years).
    const dep = (await t.get(`/api/v1/assets/${laptop.id}/depreciation`).expect(200)).body.data;
    expect(dep.rows.length).toBeGreaterThanOrEqual(3);

    // Check-out to the employee.
    const assignment = (
      await t
        .post(`/api/v1/assets/${laptop.id}/checkout`, {
          employeeId: employee.id,
          accessories: ['Charger', 'Bag'],
        })
        .expect(201)
    ).body.data;
    expect(assignment).toMatchObject({ status: 'ACTIVE', employeeId: employee.id });
    const assigned = (await t.get(`/api/v1/assets/${laptop.id}`).expect(200)).body.data;
    expect(assigned.status).toBe('ASSIGNED');
    expect(assigned.activeAssignment.id).toBe(assignment.id);
    // Cannot check out twice.
    await t.post(`/api/v1/assets/${laptop.id}/checkout`, { employeeId: employee.id }).expect(409);

    // Employee exit: the checklist gets a "Return assigned assets" item.
    await t
      .post(`/api/v1/employees/${employee.id}/resign`, {
        resignationDate: addDays(today(), -30),
        lastWorkingDate: today(),
        reason: 'Relocating',
      })
      .expect(200);
    const exitItem = async () =>
      (await t.get(`/api/v1/employees/${employee.id}/checklist`).expect(200)).body.data.find(
        (i: { kind: string; key: string }) => i.kind === 'EXIT' && i.key === 'asset_recovery',
      );
    expect((await exitItem())?.status).toBe('PENDING');

    // Check-in completes the exit checklist item.
    const returned = (
      await t.post(`/api/v1/assets/${laptop.id}/checkin`, { condition: 'GOOD' }).expect(200)
    ).body.data;
    expect(returned.status).toBe('RETURNED');
    expect((await exitItem())?.status).toBe('DONE');
    expect((await t.get(`/api/v1/assets/${laptop.id}`).expect(200)).body.data.status).toBe(
      'IN_STOCK',
    );

    // Maintenance ticket moves the asset under repair and back.
    const ticket = (
      await t
        .post('/api/v1/assets/maintenance', {
          assetId: laptop.id,
          type: 'REPAIR',
          title: 'Battery swelling',
        })
        .expect(201)
    ).body.data;
    await t.patch(`/api/v1/assets/maintenance/${ticket.id}`, { status: 'IN_PROGRESS' }).expect(200);
    expect((await t.get(`/api/v1/assets/${laptop.id}`).expect(200)).body.data.status).toBe(
      'UNDER_REPAIR',
    );
    await t
      .patch(`/api/v1/assets/maintenance/${ticket.id}`, {
        status: 'COMPLETED',
        cost: 4500,
        resolution: 'Battery replaced',
      })
      .expect(200);
    expect((await t.get(`/api/v1/assets/${laptop.id}`).expect(200)).body.data.status).toBe(
      'IN_STOCK',
    );

    // Physical verification: scan one tag, mark the other missing.
    const audit = (
      await t
        .post('/api/v1/assets/audits', { institutionId: institution.id, name: 'Annual 2026' })
        .expect(201)
    ).body.data;
    expect(audit.counts.total).toBe(2);
    await t.post(`/api/v1/assets/audits/${audit.id}/verify`, { assetTag: 'LT-0001' }).expect(200);
    await t
      .post(`/api/v1/assets/audits/${audit.id}/verify`, { assetId: spare.id, result: 'MISSING' })
      .expect(200);
    const done = (await t.post(`/api/v1/assets/audits/${audit.id}/complete`, {}).expect(200)).body
      .data;
    expect(done.status).toBe('COMPLETED');
    expect(done.counts.VERIFIED).toBe(1);
    expect(done.counts.MISSING).toBe(1);

    // Disposal (no approval workflow configured → direct approve).
    const disposal = (
      await t
        .post('/api/v1/assets/disposals', {
          assetId: spare.id,
          method: 'WRITTEN_OFF',
          disposalDate: today(),
          reason: 'Not found during audit',
        })
        .expect(201)
    ).body.data;
    expect(disposal.status).toBe('PENDING_APPROVAL');
    await t.post(`/api/v1/assets/disposals/${disposal.id}/approve`, {}).expect(200);
    expect((await t.get(`/api/v1/assets/${spare.id}`).expect(200)).body.data.status).toBe(
      'DISPOSED',
    );
    await t.post(`/api/v1/assets/${spare.id}/checkout`, { employeeId: employee.id }).expect(409);

    // Inventory with reorder alert.
    const item = (
      await t
        .post('/api/v1/assets/inventory', {
          institutionId: institution.id,
          sku: `TONER-${run}`,
          name: 'Printer toner',
          unit: 'pcs',
          reorderLevel: 5,
          openingQuantity: 8,
        })
        .expect(201)
    ).body.data;
    expect(item.lowStock).toBe(false);
    const after = (
      await t
        .post(`/api/v1/assets/inventory/${item.id}/transactions`, { type: 'OUT', quantity: 4 })
        .expect(201)
    ).body.data;
    expect(after.item).toMatchObject({ quantity: 4, lowStock: true });
    await t
      .post(`/api/v1/assets/inventory/${item.id}/transactions`, { type: 'OUT', quantity: 10 })
      .expect(409);

    // Reports and dashboard.
    const report = (
      await t
        .get(`/api/v1/assets/reports?type=register&institutionId=${institution.id}`)
        .expect(200)
    ).body.data;
    expect(report.rows.length).toBe(2);
    const csv = await t
      .get(`/api/v1/assets/reports?type=depreciation&format=csv&institutionId=${institution.id}`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const dash = (await t.get('/api/v1/assets/dashboard').expect(200)).body.data;
    expect(dash).toBeTruthy();

    // Tenant isolation: another organization sees nothing and cannot touch the rows.
    expect((await other.get('/api/v1/assets').expect(200)).body.meta.total).toBe(0);
    await other.get(`/api/v1/assets/${laptop.id}`).expect(404);
    await other.get(`/api/v1/assets/categories/${category.id}`).expect(404);
    await other
      .post(`/api/v1/assets/${laptop.id}/checkout`, { employeeId: employee.id })
      .expect(404);
    await other
      .post('/api/v1/assets', { institutionId: institution.id, categoryId: category.id, name: 'X' })
      .expect(422);
  });
});
