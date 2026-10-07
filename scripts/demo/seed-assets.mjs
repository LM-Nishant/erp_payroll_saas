// Idempotent asset-management demo seed through the public HTTP API.
//   API_URL=http://localhost:3105/api/v1 node scripts/demo/seed-assets.mjs
// ABBS: IT/AV/furniture/lab/sports assets in every institution (~300), custody to staff,
// departments and labs, a few repair tickets, consumables and an open verification audit.
// Logicmines: laptops, monitors and phones for most employees, spares, a few laptops under
// repair, office equipment and consumables. Also creates the asset manager logins.
// Safe to re-run: categories match by code, assets by tag, stock items by SKU; custody,
// tickets and audits are only created when missing.

const API = process.env.API_URL ?? 'http://localhost:3105/api/v1';
const PLATFORM = {
  email: process.env.PLATFORM_EMAIL ?? 'platform@erp.test',
  password: process.env.PLATFORM_PASSWORD ?? 'Demo-Passw0rd!',
};

async function login({ email, password }) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  return j.data.accessToken;
}

function client(token) {
  return async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(`${method} ${path} ${r.status}: ${JSON.stringify(j.error ?? j)}`);
      err.status = r.status;
      err.code = j.error?.code;
      throw err;
    }
    return j;
  };
}

async function all(api, path) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const j = await api('GET', `${path}${sep}page=${page}&pageSize=100`);
    out.push(...(j.data ?? []));
    if (!j.meta || out.length >= j.meta.total || !j.data?.length) return out;
  }
}

const DAY = 86_400_000;
const today = new Date();
const day = (offset) => new Date(today.getTime() + offset * DAY).toISOString().slice(0, 10);

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const pick = (arr, key) => arr[hash(key) % arr.length];
const pad = (n, w = 4) => String(n).padStart(w, '0');

const platform = client(await login(PLATFORM));
const orgs = await all(platform, '/platform/organizations');

async function orgClient(slug, reason) {
  const org = orgs.find((o) => o.slug === slug);
  if (!org) throw new Error(`Organization ${slug} not found`);
  const sub = (await platform('GET', `/platform/organizations/${org.id}/subscription`)).data;
  const enabled = new Set([...(sub.plan?.features ?? []), ...(sub.addOnFeatures ?? [])]);
  if (!enabled.has('assets')) {
    await platform('PUT', `/platform/organizations/${org.id}/subscription`, {
      planId: sub.plan.id,
      status: sub.status,
      addOnFeatures: [...new Set([...(sub.addOnFeatures ?? []), 'assets'])],
      limitOverrides: sub.limitOverrides ?? {},
      reason,
    });
  }
  const token = (await platform('POST', `/platform/organizations/${org.id}/access`, { reason }))
    .data.accessToken;
  return client(token);
}

async function ensureAssetManager(api, email, name, password) {
  const role = (await all(api, '/roles')).find((r) => r.key === 'asset_manager');
  if (!role) throw new Error('asset_manager role missing — restart the API on this branch');
  const users = await all(api, '/users');
  if (!users.some((u) => u.email.toLowerCase() === email))
    await api('POST', '/users', {
      email,
      name,
      password,
      roles: [{ roleId: role.id, scopes: [{ type: 'ORGANIZATION' }] }],
    });
}

async function ensureCategories(api, defs) {
  const existing = new Map((await all(api, '/assets/categories')).map((c) => [c.code, c]));
  for (const d of defs)
    if (!existing.has(d.code))
      existing.set(d.code, (await api('POST', '/assets/categories', d)).data);
  return existing;
}

/** Create assets that do not exist yet (matched by tag) and return them all by tag. */
async function ensureAssets(api, specs) {
  const byTag = new Map((await all(api, '/assets')).map((a) => [a.assetTag, a]));
  let created = 0;
  for (const s of specs) {
    if (byTag.has(s.assetTag)) continue;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { assign, repair, ...body } = s;
    byTag.set(s.assetTag, (await api('POST', '/assets', body)).data);
    created++;
  }
  return { byTag, created };
}

async function applyCustody(api, specs, byTag) {
  let assigned = 0;
  for (const s of specs) {
    const a = byTag.get(s.assetTag);
    if (!s.assign || !a || a.status !== 'IN_STOCK') continue;
    try {
      await api('POST', `/assets/${a.id}/checkout`, {
        ...s.assign,
        assignedAt: s.purchaseDate && s.purchaseDate > day(-45) ? s.purchaseDate : day(-45),
      });
      a.status = 'ASSIGNED';
      assigned++;
    } catch (e) {
      console.warn(`  checkout ${s.assetTag}: ${e.message}`);
    }
  }
  return assigned;
}

async function applyRepairs(api, specs, byTag) {
  const open = new Set(
    (await all(api, '/assets/maintenance?open=true')).map((m) => m.assetId ?? m.asset?.id),
  );
  let n = 0;
  for (const s of specs) {
    const a = byTag.get(s.assetTag);
    if (!s.repair || !a || open.has(a.id) || a.status === 'DISPOSED') continue;
    const t = (
      await api('POST', '/assets/maintenance', {
        assetId: a.id,
        type: s.repair.warranty ? 'WARRANTY_CLAIM' : 'REPAIR',
        priority: s.repair.priority ?? 'MEDIUM',
        title: s.repair.title,
        vendor: s.repair.vendor,
        underWarranty: Boolean(s.repair.warranty),
      })
    ).data;
    await api('PATCH', `/assets/maintenance/${t.id}`, { status: 'IN_PROGRESS' });
    n++;
  }
  return n;
}

async function ensureHistory(api, byTag, tags, title) {
  const done = new Set(
    (await all(api, '/assets/maintenance?status=COMPLETED')).map((m) => m.assetId ?? m.asset?.id),
  );
  for (const [i, tag] of tags.entries()) {
    const a = byTag.get(tag);
    if (!a || done.has(a.id) || a.status === 'DISPOSED') continue;
    const t = (
      await api('POST', '/assets/maintenance', {
        assetId: a.id,
        type: 'PREVENTIVE',
        title,
        vendor: 'ServiceCare Pvt Ltd',
        scheduledDate: day(-90 + i),
      })
    ).data;
    await api('PATCH', `/assets/maintenance/${t.id}`, {
      status: 'COMPLETED',
      completedAt: day(-88 + i),
      cost: 800 + (hash(tag) % 8) * 250,
      resolution: 'Serviced, cleaned and tested',
      nextServiceDate: day(90 + i),
    });
  }
}

async function ensureInventory(api, institutionId, items) {
  const existing = new Set(
    (await all(api, `/assets/inventory?institutionId=${institutionId}`)).map((i) => i.sku),
  );
  for (const it of items)
    if (!existing.has(it.sku)) await api('POST', '/assets/inventory', { institutionId, ...it });
}

const stock = (sku, name, category, unit, reorderLevel, unitCost, openingQuantity, location) => ({
  sku,
  name,
  category,
  unit,
  reorderLevel,
  unitCost,
  openingQuantity,
  location,
});

const IT_CATS = [
  {
    code: 'LAPTOP',
    name: 'Laptops',
    kind: 'IT',
    depreciationMethod: 'WDV',
    depreciationRate: 40,
    usefulLifeYears: 3,
    tagPrefix: 'LAP-',
    attributes: [
      { key: 'ram', label: 'RAM (GB)', type: 'number' },
      { key: 'storage', label: 'Storage', type: 'text' },
      { key: 'os', label: 'OS', type: 'select', options: ['Windows 11', 'macOS', 'Ubuntu'] },
    ],
  },
  {
    code: 'DESKTOP',
    name: 'Desktops',
    kind: 'IT',
    depreciationMethod: 'WDV',
    depreciationRate: 40,
    usefulLifeYears: 4,
    tagPrefix: 'DSK-',
    attributes: [{ key: 'ram', label: 'RAM (GB)', type: 'number' }],
  },
  {
    code: 'MONITOR',
    name: 'Monitors',
    kind: 'IT',
    depreciationMethod: 'SLM',
    usefulLifeYears: 5,
    tagPrefix: 'MON-',
    attributes: [{ key: 'size', label: 'Size (in)', type: 'number' }],
  },
  {
    code: 'PRINTER',
    name: 'Printers & scanners',
    kind: 'IT',
    depreciationMethod: 'SLM',
    usefulLifeYears: 5,
    tagPrefix: 'PRN-',
  },
];

/* ======================================== ABBS ========================================= */
async function seedAbbs() {
  console.log('ABBS…');
  const api = await orgClient('abbs', 'Asset management demo seed (ABBS)');
  await ensureAssetManager(api, 'abbs.assets@abbs.test', 'ABBS Asset Manager', 'Abbs@2026Demo');
  await ensureCategories(api, [
    ...IT_CATS,
    {
      code: 'PROJECTOR',
      name: 'Projectors & smart boards',
      kind: 'AV',
      depreciationMethod: 'SLM',
      usefulLifeYears: 6,
      tagPrefix: 'AV-',
    },
    {
      code: 'FURNITURE',
      name: 'Furniture',
      kind: 'FURNITURE',
      depreciationMethod: 'SLM',
      usefulLifeYears: 10,
      tagPrefix: 'FUR-',
      attributes: [{ key: 'material', label: 'Material', type: 'text' }],
    },
    {
      code: 'LABEQ',
      name: 'Lab equipment',
      kind: 'LAB_EQUIPMENT',
      depreciationMethod: 'SLM',
      usefulLifeYears: 8,
      tagPrefix: 'LAB-',
      attributes: [{ key: 'lab', label: 'Lab', type: 'text' }],
    },
    {
      code: 'SPORTS',
      name: 'Sports equipment',
      kind: 'SPORTS',
      depreciationMethod: 'SLM',
      usefulLifeYears: 5,
      tagPrefix: 'SPT-',
    },
  ]);
  const cats = new Map((await all(api, '/assets/categories')).map((c) => [c.code, c.id]));
  const institutions = await all(api, '/institutions');
  const employees = (await all(api, '/employees')).filter((e) =>
    ['ACTIVE', 'ONBOARDING', 'ON_NOTICE'].includes(e.status),
  );
  const specs = [];
  for (const inst of institutions) {
    const school = inst.type === 'SCHOOL';
    const departments = await all(api, `/departments?institutionId=${inst.id}`);
    const staff = employees.filter((e) => e.institutionId === inst.id);
    const base = {
      institutionId: inst.id,
      vendor: pick(['Croma Business', 'Redington India', 'Ingram Micro'], inst.code),
    };
    const add = (code, n, make) => {
      for (let i = 1; i <= n; i++) {
        const tag = `${inst.code}-${code}-${pad(i, 3)}`;
        const purchaseDate = day(-(120 + (hash(tag) % 900)));
        specs.push({
          ...base,
          assetTag: tag,
          categoryId: cats.get(code),
          purchaseDate,
          invoiceNo: `INV/${inst.code}/${purchaseDate.slice(0, 4)}/${pad(hash(tag) % 9000, 4)}`,
          ...make(i, tag),
        });
      }
    };
    const labRoom = school ? 'Computer Lab' : 'Computer Centre';
    const room = school ? 'Classroom' : 'Lecture hall';
    add('DESKTOP', school ? 8 : 10, (i, tag) => ({
      name: 'Lab desktop',
      make: 'HP',
      model: 'ProDesk 400 G9',
      serialNo: `HP${hash(tag).toString(36).toUpperCase()}`,
      purchaseCost: 48500,
      warrantyExpiry: day(-200 + (hash(tag) % 500)),
      attributes: { ram: 8 },
      location: `${labRoom} — seat ${i}`,
      condition: pick(['GOOD', 'GOOD', 'FAIR'], tag),
      assign: { targetType: 'LOCATION', location: `${labRoom} — seat ${i}` },
    }));
    add('LAPTOP', 4, (i, tag) => {
      const emp = staff[i - 1];
      const dept = departments[(i - 1) % Math.max(1, departments.length)];
      return {
        name: 'Faculty laptop',
        make: 'Lenovo',
        model: 'ThinkPad E14 Gen 5',
        serialNo: `PF${hash(tag).toString(36).toUpperCase()}`,
        purchaseCost: 68000,
        warrantyExpiry: day(20 + (hash(tag) % 400)),
        attributes: { ram: 16, storage: '512 GB SSD', os: 'Windows 11' },
        condition: 'GOOD',
        assign: emp
          ? { employeeId: emp.id, accessories: ['Charger', 'Laptop bag'] }
          : dept
            ? { targetType: 'DEPARTMENT', departmentId: dept.id }
            : undefined,
      };
    });
    add('PROJECTOR', school ? 6 : 5, (i, tag) => ({
      name: i % 3 === 0 ? 'Interactive smart board' : 'Classroom projector',
      make: i % 3 === 0 ? 'BenQ' : 'Epson',
      model: i % 3 === 0 ? 'RP7503' : 'EB-X51',
      serialNo: `AV${hash(tag).toString(36).toUpperCase()}`,
      purchaseCost: i % 3 === 0 ? 145000 : 42000,
      warrantyExpiry: day(-30 + (hash(tag) % 200)),
      amcVendor: 'AV Solutions Bengaluru',
      amcExpiry: day(5 + (hash(tag) % 120)),
      serviceIntervalDays: 180,
      nextServiceDate: day(-2 + (hash(tag) % 40)),
      location: `${room} ${100 + i}`,
      condition: 'GOOD',
      assign: { targetType: 'LOCATION', location: `${room} ${100 + i}` },
      repair:
        i === 2
          ? { title: 'Lamp flickering, colour cast', vendor: 'AV Solutions Bengaluru' }
          : undefined,
    }));
    add('FURNITURE', 8, (_i, tag) => ({
      name: pick(['Staff room table', 'Faculty chair', 'Steel almirah', 'Library rack'], tag),
      make: pick(['Godrej Interio', 'Featherlite', 'Nilkamal'], tag),
      purchaseCost: 6000 + (hash(tag) % 10) * 1200,
      attributes: { material: pick(['Wood', 'Steel', 'Mesh'], `${tag}m`) },
      location: pick(['Staff room', 'Library', 'Admin office', 'Principal office'], `${tag}l`),
      condition: pick(['GOOD', 'GOOD', 'FAIR', 'POOR'], tag),
    }));
    const labs = school
      ? ['Physics lab', 'Chemistry lab', 'Biology lab']
      : ['Electronics lab', 'Physics lab', 'Chemistry lab'];
    const kit = school
      ? [
          ['Compound microscope', 'Labomed', 'Vision 2000', 18500],
          ['Physical balance', 'Contech', 'CTG-300', 9500],
          ['Human skeleton model', 'Eisco', 'HSM-170', 12000],
        ]
      : [
          ['Digital storage oscilloscope', 'Tektronix', 'TBS1072C', 68000],
          ['Function generator', 'Scientech', '4065', 22000],
          ['UV-Vis spectrophotometer', 'Systronics', '2203', 185000],
        ];
    add('LABEQ', 5, (i, tag) => {
      const [name, make, model, cost] = kit[(i - 1) % kit.length];
      const lab = labs[(i - 1) % labs.length];
      return {
        name,
        make,
        model,
        serialNo: `LB${hash(tag).toString(36).toUpperCase()}`,
        purchaseCost: cost,
        warrantyExpiry: day(-100 + (hash(tag) % 300)),
        serviceIntervalDays: 365,
        nextServiceDate: day(hash(tag) % 60),
        attributes: { lab },
        location: lab,
        condition: 'GOOD',
      };
    });
    add('SPORTS', 2, (i, tag) => ({
      name: i === 1 ? 'Table tennis table' : 'Basketball hoop (portable)',
      make: i === 1 ? 'Stag' : 'Vinex',
      purchaseCost: i === 1 ? 32000 : 27000,
      location: 'Sports room',
      condition: pick(['GOOD', 'FAIR'], tag),
    }));
    add('PRINTER', 1, (_i, tag) => ({
      name: 'Office multifunction printer',
      make: 'Canon',
      model: 'imageRUNNER 2206',
      serialNo: `CN${hash(tag).toString(36).toUpperCase()}`,
      purchaseCost: 58000,
      amcVendor: 'Canon Care',
      amcExpiry: day(25),
      location: 'Admin office',
      condition: 'GOOD',
    }));
  }
  const { byTag, created } = await ensureAssets(api, specs);
  const assigned = await applyCustody(api, specs, byTag);
  const repairs = await applyRepairs(api, specs, byTag);
  await ensureHistory(
    api,
    byTag,
    specs
      .filter((s) => s.assetTag.includes('-PROJECTOR-00') && !s.repair)
      .slice(0, 12)
      .map((s) => s.assetTag),
    'Half-yearly projector service',
  );
  for (const inst of institutions) {
    const h = (s) => hash(`${inst.code}${s}`);
    await ensureInventory(api, inst.id, [
      stock(
        'CHALK-BOX',
        'Dustless chalk (box of 100)',
        'Stationery',
        'box',
        20,
        85,
        12 + (h('c') % 40),
        'Store room',
      ),
      stock('MARKER-WB', 'Whiteboard marker', 'Stationery', 'pcs', 50, 35, 120, 'Store room'),
      stock(
        'A4-REAM',
        'A4 paper ream (500 sheets)',
        'Stationery',
        'ream',
        25,
        260,
        20 + (h('a') % 60),
        'Store room',
      ),
      stock(
        'LAB-GLOVES',
        'Nitrile lab gloves',
        'Lab consumables',
        'box',
        10,
        450,
        6 + (h('g') % 12),
        'Lab store',
      ),
    ]);
  }
  const first = institutions.find((i) => i.code === 'AEC') ?? institutions[0];
  if (first && !(await all(api, '/assets/audits')).length)
    await api('POST', '/assets/audits', {
      institutionId: first.id,
      categoryId: cats.get('DESKTOP'),
      name: `Computer lab verification ${today.getFullYear()}`,
    });
  console.log(
    `  ABBS: ${byTag.size} assets (+${created}), ${assigned} checked out, ${repairs} repairs`,
  );
}

/* ===================================== Logicmines ====================================== */
async function seedLogicmines() {
  console.log('Logicmines…');
  const api = await orgClient('logicmines', 'Asset management demo seed (Logicmines)');
  await ensureAssetManager(
    api,
    'assets@logicmines.in',
    'Logicmines IT Asset Desk',
    'Logicmines@2026',
  );
  await ensureCategories(api, [
    ...IT_CATS.map((c) => ({ ...c, code: `LM-${c.code}`, tagPrefix: `LM-${c.tagPrefix}` })),
    {
      code: 'LM-PHONE',
      name: 'Mobile phones',
      kind: 'MOBILE',
      depreciationMethod: 'WDV',
      depreciationRate: 40,
      usefulLifeYears: 3,
      tagPrefix: 'LM-PH-',
      attributes: [{ key: 'imei', label: 'IMEI', type: 'text' }],
    },
    {
      code: 'LM-FURN',
      name: 'Office furniture',
      kind: 'FURNITURE',
      depreciationMethod: 'SLM',
      usefulLifeYears: 10,
      tagPrefix: 'LM-FUR-',
    },
  ]);
  const cats = new Map((await all(api, '/assets/categories')).map((c) => [c.code, c.id]));
  const institutions = await all(api, '/institutions');
  const employees = (await all(api, '/employees'))
    .filter((e) => ['ACTIVE', 'ONBOARDING', 'ON_NOTICE'].includes(e.status))
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const specs = [];
  const n = { lt: 0, mon: 0, ph: 0 };
  const laptops = [
    ['Dell', 'Latitude 5440', 92000, 'Windows 11'],
    ['Lenovo', 'ThinkPad T14 Gen 4', 98000, 'Windows 11'],
    ['Apple', 'MacBook Air M2', 114900, 'macOS'],
    ['HP', 'EliteBook 840 G10', 95000, 'Windows 11'],
  ];
  const phones = [
    ['Samsung', 'Galaxy A55', 39999],
    ['Apple', 'iPhone 15', 72900],
    ['OnePlus', 'Nord CE4', 24999],
  ];
  const faults = [
    'Keyboard keys not working',
    'Battery not charging',
    'Display flicker',
    'Fan noise / overheating',
  ];
  for (const [idx, e] of employees.entries()) {
    const key = e.employeeCode;
    const base = { institutionId: e.institutionId, vendor: 'Redington India' };
    const isDemo = e.workEmail === 'lmt.it2@logicmines.in';
    // ~92% get a laptop, ~65% an external monitor, ~35% a company phone.
    if (isDemo || hash(`${key}lt`) % 100 < 92) {
      const [make, model, cost, os] = pick(laptops, key);
      const tag = `LM-LT-${pad(++n.lt)}`;
      const purchaseDate = day(-(60 + (hash(key) % 1000)));
      specs.push({
        ...base,
        assetTag: tag,
        categoryId: cats.get('LM-LAPTOP'),
        name: `${make} ${model}`,
        make,
        model,
        serialNo: `${make.slice(0, 2).toUpperCase()}${hash(tag).toString(36).toUpperCase()}`,
        purchaseDate,
        invoiceNo: `RIL/${purchaseDate.slice(0, 4)}/${pad(hash(tag) % 90000, 5)}`,
        purchaseCost: cost,
        warrantyExpiry: day(1035 - (hash(key) % 1000)),
        attributes: { ram: os === 'macOS' ? 16 : pick([16, 32], key), storage: '512 GB SSD', os },
        condition: pick(['NEW', 'GOOD', 'GOOD', 'FAIR'], tag),
        assign: { employeeId: e.id, accessories: ['Charger', 'Backpack'] },
        repair:
          idx % 31 === 7
            ? {
                title: pick(faults, key),
                vendor: `${make} Service Centre`,
                warranty: true,
                priority: 'HIGH',
              }
            : undefined,
      });
    }
    if (isDemo || hash(`${key}mon`) % 100 < 65) {
      const tag = `LM-MON-${pad(++n.mon)}`;
      specs.push({
        ...base,
        assetTag: tag,
        categoryId: cats.get('LM-MONITOR'),
        name: 'Dell 24" monitor',
        make: 'Dell',
        model: 'P2422H',
        serialNo: `CN${hash(tag).toString(36).toUpperCase()}`,
        purchaseDate: day(-(90 + (hash(tag) % 700))),
        purchaseCost: 16500,
        warrantyExpiry: day(1005 - (hash(tag) % 700)),
        attributes: { size: 24 },
        condition: 'GOOD',
        assign: { employeeId: e.id, accessories: ['HDMI cable'] },
      });
    }
    if (isDemo || hash(`${key}ph`) % 100 < 35) {
      const [make, model, cost] = pick(phones, `${key}ph`);
      const tag = `LM-PH-${pad(++n.ph)}`;
      specs.push({
        ...base,
        assetTag: tag,
        categoryId: cats.get('LM-PHONE'),
        name: `${make} ${model}`,
        make,
        model,
        serialNo: `PH${hash(tag).toString(36).toUpperCase()}`,
        purchaseDate: day(-(30 + (hash(tag) % 500))),
        purchaseCost: cost,
        warrantyExpiry: day(395 - (hash(tag) % 500)),
        attributes: { imei: `35${String(hash(tag)).padStart(13, '0').slice(0, 13)}` },
        condition: 'GOOD',
        assign: { employeeId: e.id, accessories: ['Charger', 'Case'] },
      });
    }
  }
  for (const inst of institutions) {
    for (let i = 1; i <= 3; i++) {
      const tag = `LM-SPARE-${inst.code}-${i}`;
      specs.push({
        institutionId: inst.id,
        assetTag: tag,
        categoryId: cats.get('LM-LAPTOP'),
        name: 'Dell Latitude 3440 (spare pool)',
        make: 'Dell',
        model: 'Latitude 3440',
        serialNo: `SP${hash(tag).toString(36).toUpperCase()}`,
        purchaseDate: day(-200),
        purchaseCost: 61000,
        warrantyExpiry: day(530),
        attributes: { ram: 16, storage: '256 GB SSD', os: 'Windows 11' },
        location: 'IT store',
        condition: 'NEW',
      });
    }
    specs.push({
      institutionId: inst.id,
      assetTag: `LM-PRN-${inst.code}`,
      categoryId: cats.get('LM-PRINTER'),
      name: 'HP LaserJet MFP',
      make: 'HP',
      model: 'LaserJet Pro MFP 4104fdw',
      serialNo: `HPP${hash(inst.code).toString(36).toUpperCase()}`,
      purchaseDate: day(-400),
      purchaseCost: 46000,
      amcVendor: 'HP Care Pack',
      amcExpiry: day(18 + (hash(inst.code) % 30)),
      serviceIntervalDays: 90,
      nextServiceDate: day(hash(inst.code) % 10),
      location: 'Office floor — print corner',
      condition: 'GOOD',
    });
    for (let i = 1; i <= 4; i++)
      specs.push({
        institutionId: inst.id,
        assetTag: `LM-FUR-${inst.code}-${i}`,
        categoryId: cats.get('LM-FURN'),
        name: i <= 2 ? 'Conference table (8 seater)' : 'Ergonomic chair batch',
        make: 'Featherlite',
        purchaseDate: day(-700),
        purchaseCost: i <= 2 ? 48000 : 85000,
        location: i <= 2 ? `Meeting room ${i}` : 'Workstations',
        condition: 'GOOD',
      });
  }
  const { byTag, created } = await ensureAssets(api, specs);
  const assigned = await applyCustody(api, specs, byTag);
  const repairs = await applyRepairs(api, specs, byTag);
  await ensureHistory(
    api,
    byTag,
    institutions.map((i) => `LM-PRN-${i.code}`),
    'Quarterly printer service',
  );
  for (const inst of institutions) {
    const h = (s) => hash(`${inst.code}${s}`);
    await ensureInventory(api, inst.id, [
      stock(
        'TONER-149A',
        'HP 149A toner',
        'Printer supplies',
        'pcs',
        3,
        6200,
        1 + (h('t') % 5),
        'IT store',
      ),
      stock(
        'USB-C-HUB',
        'USB-C multiport adapter',
        'IT accessories',
        'pcs',
        5,
        2400,
        4 + (h('h') % 10),
        'IT store',
      ),
      stock('MOUSE-WL', 'Wireless mouse', 'IT accessories', 'pcs', 10, 650, 18, 'IT store'),
      stock(
        'HEADSET',
        'USB headset',
        'IT accessories',
        'pcs',
        8,
        1800,
        5 + (h('s') % 12),
        'IT store',
      ),
    ]);
  }
  // A pending write-off request for a spare that was lost in transit.
  const lost = byTag.get(`LM-SPARE-${institutions[0]?.code}-3`);
  if (lost && lost.status === 'IN_STOCK') {
    const pending = await all(api, '/assets/disposals?status=PENDING_APPROVAL');
    if (!pending.some((d) => d.assetId === lost.id))
      await api('POST', '/assets/disposals', {
        assetId: lost.id,
        method: 'WRITTEN_OFF',
        disposalDate: day(0),
        reason: 'Lost in transit between branches (police complaint filed)',
      });
  }
  // The demo employee acknowledges receipt of part of their kit (one stays pending).
  try {
    const me = client(await login({ email: 'lmt.it2@logicmines.in', password: 'Logicmines@2026' }));
    const mine = (await me('GET', '/assets/my')).data;
    for (const m of mine.slice(0, Math.max(1, mine.length - 1)))
      if (!m.assignment.acknowledgedAt)
        await me('POST', `/assets/my/${m.assignment.id}/acknowledge`, {
          note: 'Received in good condition',
        });
  } catch (e) {
    console.warn(`  acknowledge as lmt.it2: ${e.message}`);
  }
  console.log(
    `  Logicmines: ${byTag.size} assets (+${created}), ${assigned} checked out, ${repairs} repairs`,
  );
}

await seedAbbs();
await seedLogicmines();
console.log(
  'Done. Asset managers: abbs.assets@abbs.test / Abbs@2026Demo, assets@logicmines.in / Logicmines@2026',
);
