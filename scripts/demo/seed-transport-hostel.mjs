#!/usr/bin/env node
/**
 * Demo seed for the transport and hostel modules (HTTP API based, idempotent).
 *
 *   API_URL=http://127.0.0.1:3104 node scripts/demo/seed-transport-hostel.mjs
 *
 * For the ABBS demo org it:
 *  - enables the `transport` / `hostel` modules if an org override switched them off;
 *  - creates logins aec.transport@abbs.test (transport_manager), aec.warden@abbs.test and
 *    ait.warden@abbs.test (hostel_warden), password Abbs@2026Demo, institution-scoped;
 *  - per institution with students: 4–8 vehicles with drivers/attendants, 5–9 routes with
 *    stops, distance fare slabs, ~35% of students allocated, this month's charges, a day of
 *    trips with boarding, fuel / maintenance logs and incidents;
 *  - for the engineering colleges (AEC, AIT): a boys' and a girls' hostel with a block, rooms,
 *    beds and mess plans, ~30 residents each (~120 total), out-passes (pending / approved /
 *    rejected), visitors, in/out register entries, complaints and last night's roll call.
 *
 * Everything is upserted by natural keys (vehicle regNo, staff name, route code, hostel code,
 * room number, student) so the script can be re-run safely.
 *
 * Existing organizations only get the new system roles / permissions after
 * `pnpm --filter @erp/api db:sync-roles` (run once after migrating).
 */
const API = (process.env.API_URL ?? 'http://127.0.0.1:3104').replace(/\/+$/, '');
const ORG = 'abbs';
const ADMIN = { email: 'abbs.admin@abbs.test', password: 'Abbs@2026Demo' };
const PASSWORD = 'Abbs@2026Demo';
const ENGINEERING = ['AEC', 'AIT'];
const LOGINS = [
  {
    email: 'aec.transport@abbs.test',
    name: 'AEC Transport Manager',
    role: 'transport_manager',
    institution: 'AEC',
  },
  {
    email: 'aec.warden@abbs.test',
    name: 'AEC Hostel Warden',
    role: 'hostel_warden',
    institution: 'AEC',
  },
  {
    email: 'ait.warden@abbs.test',
    name: 'AIT Hostel Warden',
    role: 'hostel_warden',
    institution: 'AIT',
  },
];

const LOCALITIES = [
  'Jayanagar',
  'BTM Layout',
  'Koramangala',
  'HSR Layout',
  'Banashankari',
  'JP Nagar',
  'Basavanagudi',
  'Rajajinagar',
  'Malleshwaram',
  'Yeshwanthpur',
  'Hebbal',
  'Indiranagar',
  'Whitefield',
  'Marathahalli',
  'Electronic City',
  'Bommanahalli',
  'Vijayanagar',
  'Kengeri',
  'RR Nagar',
  'Yelahanka',
];
const DRIVERS = [
  'Ramesh Gowda',
  'Suresh Kumar',
  'Manjunath R',
  'Venkatesh B',
  'Prakash Shetty',
  'Nagaraj K',
  'Ravi Chandra',
  'Mahesh Naik',
  'Shivakumar S',
  'Anand Rao',
];
const ATTENDANTS = ['Lakshmi Devi', 'Savitha M', 'Kavya R', 'Shobha N', 'Geetha K', 'Pushpa B'];

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => new Date(today.getTime() + n * 86_400_000);
const atTime = (dayOffset, hh, mm = 0) => {
  const d = addDays(dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};
const hhmm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const period = iso(today).slice(0, 7);
const academicStart = `${today.getMonth() >= 5 ? today.getFullYear() : today.getFullYear() - 1}-06-01`;

let token;
async function call(method, path, body, as) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...((as ?? token) ? { Authorization: `Bearer ${as ?? token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`,
    );
    err.status = res.status;
    throw err;
  }
  return json;
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b ?? {});
const qs = (o) =>
  new URLSearchParams(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
async function listAll(path, query = {}) {
  const out = [];
  for (let page = 1; ; page += 1) {
    const r = await get(`${path}?${qs({ ...query, page, pageSize: 100 })}`);
    out.push(...r.data);
    if (!r.meta || out.length >= r.meta.total || r.data.length === 0) return out;
  }
}
const studentName = (s) =>
  s.name ?? s.fullName ?? [s.firstName, s.lastName].filter(Boolean).join(' ');
const ignoreConflict = (e) => {
  if (e.status !== 409 && e.status !== 422) throw e;
};

// ---------------------------------------------------------------------------------------------
async function ensureFeatures() {
  const features = (await get('/api/v1/features')).data.features;
  for (const key of ['transport', 'hostel']) {
    const f = features.find((x) => x.key === key);
    if (!f?.licensed) throw new Error(`'${key}' is not licensed for ${ORG}'s plan`);
    if (!f.enabled) {
      await call('PUT', '/api/v1/features/overrides', {
        scopeType: 'ORGANIZATION',
        featureKey: key,
        enabled: true,
      });
      console.log(`enabled the ${key} module`);
    }
  }
}

async function ensureLogins(institutions) {
  const roles = await listAll('/api/v1/roles');
  for (const l of LOGINS) {
    const inst = institutions.find((i) => i.code === l.institution);
    if (!inst) continue;
    const role = roles.find((r) => r.key === l.role);
    if (!role) {
      console.warn(`role ${l.role} missing — run \`pnpm --filter @erp/api db:sync-roles\` first`);
      continue;
    }
    const assignment = [{ roleId: role.id, scopes: [{ type: 'INSTITUTION', id: inst.id }] }];
    const existing = (await listAll('/api/v1/users', { search: l.email })).find(
      (u) => (u.email ?? u.user?.email) === l.email,
    );
    if (existing) {
      await call('PUT', `/api/v1/users/${existing.id}/roles`, { roles: assignment });
    } else {
      await post('/api/v1/users', {
        email: l.email,
        name: l.name,
        password: PASSWORD,
        roles: assignment,
      });
      console.log(`created login ${l.email}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
async function seedTransport(inst, idx, students) {
  const T = '/api/v1/transport';
  const nVehicles = [6, 5, 8, 7, 4][idx % 5];
  const nRoutes = Math.min(9, Math.max(5, nVehicles + 1));
  const plate = `KA-${String(1 + idx * 4).padStart(2, '0')}-${inst.code.slice(0, 2)}`;

  // Vehicles
  const vehicles = await listAll(`${T}/vehicles`, { institutionId: inst.id });
  for (let k = 0; k < nVehicles; k += 1) {
    const regNo = `${plate}-${4100 + k * 37}`;
    if (vehicles.some((v) => v.regNo === regNo)) continue;
    const small = k === nVehicles - 1;
    vehicles.push(
      (
        await post(`${T}/vehicles`, {
          institutionId: inst.id,
          regNo,
          vehicleType: small ? 'MINI_BUS' : 'BUS',
          make: small ? 'Force Traveller 26' : k % 2 ? 'Tata Starbus 50' : 'Ashok Leyland Sunshine',
          capacity: small ? 26 : k % 2 ? 50 : 42,
          insuranceExpiry: iso(addDays(20 + k * 45)),
          fitnessExpiry: iso(addDays(120 + k * 30)),
          permitExpiry: iso(addDays(200 + k * 20)),
          pollutionExpiry: iso(addDays(15 + k * 25)),
          nextServiceDate: iso(addDays(5 + k * 9)),
          odometerKm: 32_000 + k * 7_450,
        })
      ).data,
    );
  }
  const fleet = vehicles.filter((v) => v.regNo.startsWith(plate)).slice(0, nVehicles);

  // Drivers (one per vehicle) and attendants (every other vehicle)
  const staff = await listAll(`${T}/staff`, { institutionId: inst.id });
  const ensureStaff = async (name, role, vehicle, k) => {
    const found = staff.find((s) => s.name === name && s.role === role);
    if (found) return found;
    const row = (
      await post(`${T}/staff`, {
        institutionId: inst.id,
        role,
        name,
        phone: `+91 98${45 + idx}${String(100_000 + k * 1_379).slice(0, 6)}`,
        ...(role === 'DRIVER'
          ? {
              licenceNo: `KA${String(idx + 1).padStart(2, '0')}2015${String(4_000 + k * 17)}`,
              licenceExpiry: iso(addDays(30 + k * 60)),
            }
          : {}),
        vehicleId: vehicle?.id ?? null,
      })
    ).data;
    staff.push(row);
    return row;
  };
  const drivers = [];
  const attendants = [];
  for (let k = 0; k < fleet.length; k += 1) {
    const driverName = `${DRIVERS[(k + idx * 3) % DRIVERS.length]} (${inst.code})`;
    drivers.push(await ensureStaff(driverName, 'DRIVER', fleet[k], k));
    if (k % 2 === 0) {
      const name = `${ATTENDANTS[(k / 2 + idx) % ATTENDANTS.length]} (${inst.code})`;
      attendants.push(await ensureStaff(name, 'ATTENDANT', fleet[k], k));
    }
  }

  // Distance fare slabs (used when a stop has no fixed fare)
  const slabs = await listAll(`${T}/fare-slabs`, { institutionId: inst.id });
  for (const [name, minKm, maxKm, amount] of [
    ['Up to 5 km', 0, 5, 900],
    ['5–10 km', 5, 10, 1300],
    ['10–20 km', 10, 20, 1800],
    ['Beyond 20 km', 20, 60, 2400],
  ]) {
    if (slabs.some((s) => s.name === name)) continue;
    await post(`${T}/fare-slabs`, { institutionId: inst.id, name, minKm, maxKm, amount });
  }

  // Routes with ordered stops
  const routes = await listAll(`${T}/routes`, { institutionId: inst.id });
  for (let r = 0; r < nRoutes; r += 1) {
    const code = `${inst.code}-R${String(r + 1).padStart(2, '0')}`;
    if (routes.some((x) => x.code === code)) continue;
    const nStops = 5 + ((r + idx) % 3);
    const start = (r * 3 + idx * 5) % LOCALITIES.length;
    const stops = Array.from({ length: nStops }, (_, s) => {
      const place = LOCALITIES[(start + s) % LOCALITIES.length];
      const km = Math.round((nStops - s) * (2.4 + r * 0.6) * 10) / 10;
      return {
        sequence: s + 1,
        name: `${place}${s === 0 ? ' Bus Stand' : s % 2 ? ' Circle' : ' Main Road'}`,
        pickupTime: hhmm(6 * 60 + 45 + s * 9 + (r % 3) * 5),
        dropTime: hhmm(15 * 60 + 40 + (nStops - 1 - s) * 9),
        latitude: Math.round((12.9 + ((start + s) % 10) * 0.012) * 1e6) / 1e6,
        longitude: Math.round((77.55 + ((start + s) % 7) * 0.015) * 1e6) / 1e6,
        distanceKm: km,
        ...(s === 0 ? { fareAmount: km > 20 ? 2600 : 2000 } : {}),
      };
    });
    routes.push(
      (
        await post(`${T}/routes`, {
          institutionId: inst.id,
          code,
          name: `${LOCALITIES[start]} – Campus`,
          vehicleId: fleet[r % fleet.length].id,
          driverId: drivers[r % drivers.length]?.id ?? null,
          attendantId: attendants.length ? attendants[r % attendants.length].id : null,
          distanceKm: stops[0].distanceKm,
          stops,
        })
      ).data,
    );
  }
  const myRoutes = routes.filter((x) => x.code.startsWith(`${inst.code}-R`));
  const routeDetails = [];
  for (const r of myRoutes) routeDetails.push((await get(`${T}/routes/${r.id}`)).data);

  // Allocations (~35% of students)
  const active = await listAll(`${T}/allocations`, { institutionId: inst.id, status: 'ACTIVE' });
  const allocated = new Set(active.map((a) => a.studentId));
  const chosen = students.filter((_, j) => j % 20 < 7);
  let created = 0;
  for (let j = 0; j < chosen.length; j += 1) {
    const s = chosen[j];
    if (allocated.has(s.id)) continue;
    const route = routeDetails[j % routeDetails.length];
    const stops = route.stops ?? [];
    if (!stops.length) continue;
    try {
      await post(`${T}/allocations`, {
        passengerType: 'STUDENT',
        studentId: s.id,
        routeId: route.id,
        stopId: stops[(j * 7) % stops.length].id,
        tripType: j % 9 === 4 ? 'PICKUP' : j % 11 === 5 ? 'DROP' : 'BOTH',
        effectiveFrom: academicStart,
      });
      created += 1;
    } catch (e) {
      ignoreConflict(e);
    }
  }
  await post(`${T}/charges/generate`, { period, institutionId: inst.id });

  // Today's pickup trips (completed, with boarding attendance)
  const trips = await listAll(`${T}/trips`, {
    institutionId: inst.id,
    from: iso(today),
    to: iso(today),
  });
  for (const [i, route] of routeDetails.entries()) {
    if (trips.some((t) => t.route?.id === route.id && t.direction === 'PICKUP')) continue;
    const trip = (
      await post(`${T}/trips`, { routeId: route.id, tripDate: iso(today), direction: 'PICKUP' })
    ).data;
    await call('PATCH', `${T}/trips/${trip.id}`, {
      status: 'IN_PROGRESS',
      startOdometerKm: 40_000 + i * 120,
    });
    const sheet = (await get(`${T}/trips/${trip.id}/boarding`)).data;
    const rows = Array.isArray(sheet) ? sheet : (sheet.entries ?? []);
    if (rows.length)
      await call('PUT', `${T}/trips/${trip.id}/boarding`, {
        entries: rows.map((b, n) => ({
          allocationId: b.allocationId,
          status: n % 8 === 3 ? 'ABSENT' : 'BOARDED',
        })),
      });
    await call('PATCH', `${T}/trips/${trip.id}`, {
      status: 'COMPLETED',
      endOdometerKm: 40_000 + i * 120 + Math.round(route.distanceKm ?? 18),
      ...(i === 1 ? { delayMinutes: 15, notes: 'Traffic at Silk Board junction' } : {}),
    });
  }

  // Incidents, fuel and maintenance logs
  const incidents = await listAll(`${T}/incidents`, { institutionId: inst.id });
  if (incidents.length === 0) {
    await post(`${T}/incidents`, {
      institutionId: inst.id,
      routeId: routeDetails[0].id,
      vehicleId: fleet[0].id,
      occurredAt: atTime(-3, 7, 40),
      severity: 'LOW',
      title: 'Flat tyre near pickup point',
      description: 'Tyre replaced in 25 minutes; parents informed of the delay.',
    });
    await post(`${T}/incidents`, {
      institutionId: inst.id,
      routeId: routeDetails[1 % routeDetails.length].id,
      vehicleId: fleet[1 % fleet.length].id,
      occurredAt: atTime(-1, 16, 5),
      severity: 'MEDIUM',
      title: 'Minor scrape while reversing at depot',
      description: 'No injuries; rear bumper to be repaired.',
    });
  }
  const fuel = await listAll(`${T}/fuel-logs`, { institutionId: inst.id });
  const maint = await listAll(`${T}/maintenance`, { institutionId: inst.id });
  for (const [k, v] of fleet.entries()) {
    if (!fuel.some((f) => f.vehicleId === v.id))
      for (const d of [-14, -7]) {
        const litres = 60 + k * 5 + (d === -7 ? 8 : 0);
        await post(`${T}/fuel-logs`, {
          vehicleId: v.id,
          logDate: iso(addDays(d)),
          litres,
          amount: Math.round(litres * 89.6),
          odometerKm: 39_000 + k * 7_450 + (d + 14) * 60,
          vendor: 'HP Petrol Bunk, Hosur Road',
        });
      }
    if (!maint.some((m) => m.vehicleId === v.id))
      await post(`${T}/maintenance`, {
        vehicleId: v.id,
        serviceDate: iso(addDays(-40 - k * 6)),
        kind: 'SERVICE',
        description: 'Periodic service: engine oil, filters, brake inspection',
        cost: 6_500 + k * 450,
        odometerKm: 36_000 + k * 7_000,
        vendor: 'Sri Lakshmi Motors',
        nextServiceDate: iso(addDays(5 + k * 9)),
      });
  }
  console.log(
    `[${inst.code}] transport: ${fleet.length} vehicles, ${myRoutes.length} routes, ` +
      `${allocated.size + created} active allocations (+${created})`,
  );
}

// ---------------------------------------------------------------------------------------------
const ROOM_TYPES = [
  ['TRIPLE', 3, 3500],
  ['DOUBLE', 2, 4500],
  ['QUAD', 4, 3000],
  ['TRIPLE', 3, 3500],
  ['SINGLE', 1, 6500],
];

async function seedHostel(inst, d, hIdx, students, checker) {
  const H = '/api/v1/hostel';
  const hostels = await listAll(H, { institutionId: inst.id });
  let hostel = hostels.find((h) => h.code === d.code);
  if (!hostel)
    hostel = (
      await post(H, {
        institutionId: inst.id,
        code: d.code,
        name: d.name,
        hostelType: d.hostelType,
        phone: `+91 80 4${hIdx}${inst.code === 'AEC' ? '11' : '22'} 5566`,
        address: `${inst.name} campus, Kanakapura Road, Bengaluru`,
      })
    ).data;

  // Block, rooms (beds are created to match capacity) and mess plans
  const blocks = (await get(`${H}/${hostel.id}/blocks`)).data;
  const block =
    blocks.find((b) => b.name === 'Block A') ??
    (await post(`${H}/${hostel.id}/blocks`, { name: 'Block A', floors: 3 })).data;
  let rooms = await listAll(`${H}/rooms`, { hostelId: hostel.id });
  for (let floor = 1; floor <= 3; floor += 1)
    for (let n = 1; n <= 5; n += 1) {
      const roomNo = `${floor}0${n}`;
      if (rooms.some((r) => r.roomNo === roomNo)) continue;
      const [roomType, capacity, monthlyRent] = ROOM_TYPES[n - 1];
      await post(`${H}/${hostel.id}/rooms`, {
        blockId: block.id,
        floor,
        roomNo,
        roomType,
        capacity,
        monthlyRent,
        amenities: [
          'Cot',
          'Study table',
          'Wardrobe',
          ...(n === 5 ? ['Attached bath'] : []),
          ...(floor === 3 ? ['Balcony'] : []),
        ],
      });
    }
  rooms = await listAll(`${H}/rooms`, { hostelId: hostel.id });
  const plans = (await get(`${H}/${hostel.id}/mess-plans`)).data;
  for (const [name, monthlyFee, description] of [
    ['Veg', 3200, 'South Indian vegetarian, 4 meals a day'],
    ['Non-veg', 3800, 'Vegetarian plus non-veg on Wednesday and Sunday'],
  ])
    if (!plans.some((p) => p.name === name))
      plans.push(
        (await post(`${H}/${hostel.id}/mess-plans`, { name, monthlyFee, description })).data,
      );

  // Allocations: ~30 residents per hostel
  const active = await listAll(`${H}/allocations`, { hostelId: hostel.id, status: 'ACTIVE' });
  const resident = new Set(active.map((a) => a.studentId));
  const pool = students.filter((s) => s.gender === d.gender).slice(0, 30);
  for (const [j, s] of pool.entries()) {
    if (resident.has(s.id)) continue;
    const room = rooms.find((r) => r.status === 'ACTIVE' && r.occupied < r.capacity);
    if (!room) break;
    try {
      await post(`${H}/allocations`, {
        occupantType: 'STUDENT',
        studentId: s.id,
        roomId: room.id,
        messPlanId: plans[j % 3 === 0 ? 1 : 0].id,
        fromDate: academicStart,
      });
      room.occupied += 1;
      resident.add(s.id);
    } catch (e) {
      ignoreConflict(e);
    }
  }
  const residents = pool.filter((s) => resident.has(s.id));

  // Out-passes: approved, pending and rejected (decided by a second user — maker-checker),
  // plus one approved pass that went out and came back.
  const outpasses = await listAll(`${H}/outpasses`, { hostelId: hostel.id });
  const reqs = [
    ['HOME', 2, 5, 'Mysuru', 'Going home for the weekend', 'APPROVE'],
    ['OUTING', 1, 1, 'Forum Mall', 'Shopping for project materials', 'APPROVE'],
    ['MEDICAL', 0, 1, 'Apollo Clinic, Jayanagar', 'Dental appointment', 'APPROVE'],
    ['HOME', 4, 8, 'Hubballi', 'Sister’s wedding', null],
    ['OUTING', 3, 3, 'Lalbagh', 'Botanical study visit', null],
    ['OTHER', 2, 2, 'RTO office', 'Driving licence test', null],
    ['OUTING', 1, 1, 'MG Road', 'Movie with friends on a weekday', 'REJECT'],
    ['OUTING', 0, 0, 'Gandhi Bazaar', 'Buying books', 'RETURNED'],
  ];
  for (const [k, [passType, fromDay, toDay, destination, reason, decision]] of reqs.entries()) {
    const student = residents[k];
    if (!student) break;
    let op = outpasses.find((o) => o.studentId === student.id && o.reason === reason);
    if (!op)
      op = (
        await post(`${H}/outpasses`, {
          studentId: student.id,
          passType,
          fromAt: decision === 'RETURNED' ? atTime(0, 0, 30) : atTime(fromDay, 9),
          toAt: atTime(toDay, decision === 'RETURNED' ? 23 : 19),
          destination,
          reason,
        })
      ).data;
    if (!decision || op.status !== 'PENDING' || !checker) continue;
    const asChecker = (path, body) => call('POST', path, body ?? {}, checker);
    await asChecker(`${H}/outpasses/${op.id}/decide`, {
      decision: decision === 'REJECT' ? 'REJECT' : 'APPROVE',
      comment: decision === 'REJECT' ? 'Weekday outings not allowed' : 'Parent confirmed by phone',
    });
    if (decision === 'RETURNED')
      for (const step of ['checkout', 'return'])
        await asChecker(`${H}/outpasses/${op.id}/${step}`).catch((e) =>
          console.warn(`  out-pass ${step} skipped: ${e.message}`),
        );
  }

  // Visitors
  const visitors = await listAll(`${H}/visitors`, { hostelId: hostel.id });
  if (visitors.length === 0 && residents.length >= 5) {
    const vs = [
      ['Father', 'Aadhaar XXXX-4321', 'Dropping winter clothes', true],
      ['Mother', 'Aadhaar XXXX-1188', 'Weekend visit', true],
      ['Uncle', 'DL KA05 2011 0042', 'Delivering documents', true],
      ['Brother', 'College ID', 'Collecting laptop', false],
      ['Guardian', 'Aadhaar XXXX-9087', 'Fee discussion with warden', false],
    ];
    for (const [k, [relation, idProof, purpose, out]] of vs.entries()) {
      const v = (
        await post(`${H}/visitors`, {
          hostelId: hostel.id,
          studentId: residents[k].id,
          visitorName: `${relation} of ${studentName(residents[k]).split(' ')[0]}`,
          relation,
          phone: `+91 99${80 + hIdx}${String(100_000 + k * 2_345).slice(0, 6)}`,
          idProof,
          purpose,
          checkInAt: out ? atTime(-k - 1, 11 + k) : new Date().toISOString(),
        })
      ).data;
      if (out) await post(`${H}/visitors/${v.id}/checkout`);
    }
  }

  // In/out register (a late return)
  const movements = await listAll(`${H}/movements`, { hostelId: hostel.id });
  if (movements.length === 0 && residents.length > 10) {
    const studentId = residents[10].id;
    await post(`${H}/movements`, {
      hostelId: hostel.id,
      studentId,
      direction: 'OUT',
      at: atTime(-1, 18, 10),
      notes: 'City central library',
    });
    await post(`${H}/movements`, {
      hostelId: hostel.id,
      studentId,
      direction: 'IN',
      at: atTime(-1, 21, 40),
      notes: 'Returned after curfew',
    });
  }

  // Complaints
  const complaints = await listAll(`${H}/complaints`, { hostelId: hostel.id });
  if (complaints.length === 0 && residents.length >= 4) {
    const cs = [
      ['PLUMBING', 'Leaking tap in 2nd floor washroom', 'HIGH', 'IN_PROGRESS'],
      ['ELECTRICAL', 'Tube light not working in room 104', 'MEDIUM', 'RESOLVED'],
      ['FOOD', 'Breakfast served cold on weekdays', 'LOW', null],
      ['CLEANLINESS', 'Corridor not cleaned on Sunday', 'MEDIUM', null],
    ];
    for (const [k, [category, title, priority, status]] of cs.entries()) {
      const c = (
        await post(`${H}/complaints`, {
          hostelId: hostel.id,
          roomId: rooms[k % rooms.length].id,
          studentId: residents[k].id,
          category,
          title,
          priority,
        })
      ).data;
      if (status)
        await call('PATCH', `${H}/complaints/${c.id}`, {
          status,
          ...(status === 'RESOLVED' ? { resolution: 'Electrician replaced the fitting' } : {}),
        });
    }
  }

  // Last night's roll call
  const date = iso(addDays(-1));
  const sheet = (await get(`${H}/roll-call?${qs({ hostelId: hostel.id, date, session: 'NIGHT' })}`))
    .data;
  if (!sheet.rollCallId && sheet.entries.length)
    await call('PUT', `${H}/roll-call`, {
      hostelId: hostel.id,
      date,
      session: 'NIGHT',
      entries: sheet.entries.map((e, n) => ({
        studentId: e.studentId,
        status: e.onOutpass ? 'ON_LEAVE' : n % 13 === 5 ? 'ABSENT' : 'PRESENT',
      })),
    });

  console.log(`[${inst.code}] hostel ${d.code}: ${rooms.length} rooms, ${resident.size} residents`);
}

async function signIn(email) {
  const r = await call('POST', '/api/v1/auth/login', {
    email,
    password: PASSWORD,
    organization: ORG,
  });
  return r.data.accessToken;
}

async function seedHostels(inst, students) {
  // Out-pass decisions need someone other than the requester (maker-checker).
  const checkerEmails = [`${inst.code.toLowerCase()}.warden@abbs.test`];
  let checker = null;
  for (const email of checkerEmails) {
    checker = await signIn(email).catch(() => null);
    if (checker) break;
  }
  if (!checker)
    console.warn(`[${inst.code}] no out-pass checker login — leaving out-passes pending`);
  const defs = [
    {
      code: `${inst.code}-BH`,
      name: `${inst.code} Boys Hostel`,
      hostelType: 'BOYS',
      gender: 'MALE',
    },
    {
      code: `${inst.code}-GH`,
      name: `${inst.code} Girls Hostel`,
      hostelType: 'GIRLS',
      gender: 'FEMALE',
    },
  ];
  for (const [hIdx, d] of defs.entries()) await seedHostel(inst, d, hIdx, students, checker);
  await post('/api/v1/hostel/charges/generate', { period, institutionId: inst.id });
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const login = await call('POST', '/api/v1/auth/login', {
    email: ADMIN.email,
    password: ADMIN.password,
    organization: ORG,
  });
  token = login.data.accessToken;
  if (!token) throw new Error('login did not return an access token (MFA enabled?)');

  await ensureFeatures();
  const institutions = (await listAll('/api/v1/institutions')).sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  await ensureLogins(institutions);

  let idx = 0;
  for (const inst of institutions) {
    const students = (await listAll('/api/v1/students', { institutionId: inst.id }))
      .filter((s) => !s.status || s.status === 'ACTIVE')
      .sort((a, b) => String(a.admissionNo).localeCompare(String(b.admissionNo)));
    if (students.length < 20) continue;
    await seedTransport(inst, idx, students);
    idx += 1;
    if (ENGINEERING.includes(inst.code)) await seedHostels(inst, students);
  }
  const t = (await get('/api/v1/transport/dashboard')).data;
  const h = (await get('/api/v1/hostel/dashboard')).data;
  console.log('transport dashboard:', JSON.stringify(t).slice(0, 400));
  console.log('hostel dashboard:', JSON.stringify(h).slice(0, 400));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
