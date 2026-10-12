// Campus operations for the demo: library, transport, hostel, assets, documents, communication.
import { AY_START, TODAY, addDays, all, bump, pdfBlob, step } from './lib.mjs';

const BOOKS = [
  ['9780143333623', 'The Jungle Book', 'Rudyard Kipling', 'Fiction'],
  ['9780141321097', 'Charlotte\u2019s Web', 'E. B. White', 'Fiction'],
  ['9788175993730', 'Panchatantra Stories', 'Vishnu Sharma', 'Folk Tales'],
  ['9780143333265', 'Malgudi Days', 'R. K. Narayan', 'Fiction'],
  ['9780439708180', 'Harry Potter and the Sorcerer\u2019s Stone', 'J. K. Rowling', 'Fiction'],
  ['9788125928379', 'Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography'],
  ['9789352134755', 'NCERT Mathematics Grade 5', 'NCERT', 'Textbook'],
  ['9789352134762', 'NCERT EVS Looking Around Grade 5', 'NCERT', 'Textbook'],
  ['9780590353427', 'Matilda', 'Roald Dahl', 'Fiction'],
  ['9781408855652', 'The Story of My Experiments with Truth', 'M. K. Gandhi', 'Biography'],
];

/** Library policies, a small catalogue with copies, 3 student loans (one overdue). */
export async function seedLibrary(ctx, inst, students) {
  for (const [memberType, maxBooks, loanDays] of [
    ['STUDENT', 3, 14],
    ['EMPLOYEE', 6, 30],
  ]) {
    await ctx.api('PUT', '/library/policies', {
      institutionId: inst.id,
      memberType,
      maxBooks,
      loanDays,
      maxRenewals: 2,
      finePerDay: 2,
      maxFine: 100,
      holdDays: 3,
    });
  }
  for (const [i, [isbn, title, author, category]] of BOOKS.entries()) {
    await ctx.api('POST', '/library/books', {
      institutionId: inst.id,
      itemType: 'BOOK',
      isbn,
      title,
      authors: [author],
      publisher: category === 'Textbook' ? 'NCERT' : 'Penguin India',
      publicationYear: 2015 + (i % 9),
      category,
      language: 'English',
      tags: [category.toLowerCase()],
      callNumber: `${category.slice(0, 3).toUpperCase()}-${String(100 + i * 7)}`,
      url: null,
      copies: 2 + (i % 3),
      shelf: `S${String((i % 4) + 1).padStart(2, '0')}`,
      rack: `R${(i % 5) + 1}`,
    });
    bump('library_books');
  }
  const copies = await all(ctx.api, `/library/copies?institutionId=${inst.id}&status=AVAILABLE`);
  const used = new Set();
  const loans = [
    [students[0], -5],
    [students[1], -10],
    [students[2], -25], // overdue
  ];
  for (const [student, offset] of loans) {
    const copy = copies.find((c) => !used.has(c.bookId));
    if (!student || !copy) break;
    used.add(copy.bookId);
    await ctx.api('POST', '/library/issue', {
      copyId: copy.id,
      studentId: student.id,
      issuedAt: addDays(TODAY, offset),
      dueDate: addDays(TODAY, offset + 14),
    });
    bump('library_loans');
  }
}

/** One bus with driver + attendant, a route with 4 stops and student allocations. */
export async function seedTransport(ctx, inst, students, { plate }) {
  const T = '/transport';
  const vehicle = (
    await ctx.api('POST', `${T}/vehicles`, {
      institutionId: inst.id,
      regNo: `${plate}-4127`,
      vehicleType: 'BUS',
      make: 'Tata Starbus 40',
      capacity: 40,
      insuranceExpiry: addDays(TODAY, 120),
      fitnessExpiry: addDays(TODAY, 200),
      permitExpiry: addDays(TODAY, 300),
      pollutionExpiry: addDays(TODAY, 20),
      nextServiceDate: addDays(TODAY, 9),
      odometerKm: 38_450,
    })
  ).data;
  const driver = (
    await ctx.api('POST', `${T}/staff`, {
      institutionId: inst.id,
      role: 'DRIVER',
      name: 'Ramesh Gowda',
      phone: '+91 9845098450',
      licenceNo: 'KA0120150004127',
      licenceExpiry: addDays(TODAY, 400),
      vehicleId: vehicle.id,
    })
  ).data;
  const attendant = (
    await ctx.api('POST', `${T}/staff`, {
      institutionId: inst.id,
      role: 'ATTENDANT',
      name: 'Lakshmamma',
      phone: '+91 9845011223',
      vehicleId: vehicle.id,
    })
  ).data;
  const stops = [
    ['Koramangala Circle', '07:00', '15:50', 9.5, 2200],
    ['HSR Layout Main Road', '07:12', '15:38', 7.1],
    ['Agara Lake Gate', '07:24', '15:26', 4.6],
    ['Bellandur Junction', '07:36', '15:14', 2.0],
  ].map(([name, pickupTime, dropTime, distanceKm, fareAmount], i) => ({
    sequence: i + 1,
    name,
    pickupTime,
    dropTime,
    latitude: 12.93 - i * 0.01,
    longitude: 77.62 + i * 0.012,
    distanceKm,
    fareAmount: fareAmount ?? 1500 + (3 - i) * 200,
  }));
  const route = (
    await ctx.api('POST', `${T}/routes`, {
      institutionId: inst.id,
      code: `${inst.code}-R01`.slice(0, 32),
      name: 'Koramangala – Campus',
      vehicleId: vehicle.id,
      driverId: driver.id,
      attendantId: attendant.id,
      distanceKm: 9.5,
      stops,
    })
  ).data;
  const detail = (await ctx.api('GET', `${T}/routes/${route.id}`)).data;
  for (const [j, s] of students.entries()) {
    await ctx.api('POST', `${T}/allocations`, {
      passengerType: 'STUDENT',
      studentId: s.id,
      routeId: route.id,
      stopId: detail.stops[j % detail.stops.length].id,
      tripType: 'BOTH',
      effectiveFrom: AY_START,
    });
    bump('transport_allocations');
  }
  bump('transport_routes');
}

/** A hostel with one block, rooms, two mess plans and student allocations. */
export async function seedHostel(ctx, inst, students, { code, name, hostelType = 'MIXED' }) {
  const H = '/hostel';
  const hostel = (
    await ctx.api('POST', H, {
      institutionId: inst.id,
      code,
      name,
      hostelType,
      phone: '+91 8041225566',
      address: `${inst.name} campus`,
    })
  ).data;
  const block = (await ctx.api('POST', `${H}/${hostel.id}/blocks`, { name: 'Block A', floors: 2 }))
    .data;
  for (const [floor, n, roomType, capacity, monthlyRent] of [
    [1, 1, 'DOUBLE', 2, 4500],
    [1, 2, 'TRIPLE', 3, 3500],
    [2, 1, 'DOUBLE', 2, 4500],
    [2, 2, 'SINGLE', 1, 6500],
  ]) {
    await ctx.api('POST', `${H}/${hostel.id}/rooms`, {
      blockId: block.id,
      floor,
      roomNo: `${floor}0${n}`,
      roomType,
      capacity,
      monthlyRent,
      amenities: ['Cot', 'Study table', 'Wardrobe'],
    });
  }
  const plans = [];
  for (const [pname, monthlyFee, description] of [
    ['Veg', 3200, 'Vegetarian, 4 meals a day'],
    ['Non-veg', 3800, 'Non-veg on Wednesday and Sunday'],
  ]) {
    plans.push(
      (
        await ctx.api('POST', `${H}/${hostel.id}/mess-plans`, {
          name: pname,
          monthlyFee,
          description,
        })
      ).data,
    );
  }
  const rooms = await all(ctx.api, `${H}/rooms?hostelId=${hostel.id}`);
  for (const [j, s] of students.entries()) {
    const room = rooms.find((r) => (r.occupied ?? 0) < r.capacity);
    if (!room) break;
    await ctx.api('POST', `${H}/allocations`, {
      occupantType: 'STUDENT',
      studentId: s.id,
      roomId: room.id,
      messPlanId: plans[j % 2].id,
      fromDate: AY_START,
    });
    room.occupied = (room.occupied ?? 0) + 1;
    bump('hostel_allocations');
  }
  return hostel;
}

/** Asset categories, a few assets and checkouts to employees / a location. */
export async function seedAssets(ctx, inst, employees) {
  const cats = {};
  for (const c of [
    {
      code: 'LAPTOP',
      name: 'Laptops',
      kind: 'IT',
      tagPrefix: 'LAP-',
      depreciationMethod: 'WDV',
      depreciationRate: 40,
      usefulLifeYears: 3,
    },
    {
      code: 'PROJ',
      name: 'Projectors',
      kind: 'AV',
      tagPrefix: 'PRJ-',
      depreciationMethod: 'SLM',
      usefulLifeYears: 5,
    },
    {
      code: 'FURN',
      name: 'Furniture',
      kind: 'FURNITURE',
      tagPrefix: 'FUR-',
      depreciationMethod: 'SLM',
      usefulLifeYears: 10,
    },
  ]) {
    cats[c.code] = (await ctx.api('POST', '/assets/categories', c)).data;
  }
  const purchaseDate = addDays(TODAY, -200);
  const specs = [
    ['LAPTOP', 'Staff laptop', 'Lenovo', 'ThinkPad E14', 62000, 'Staff room', employees[0]],
    ['LAPTOP', 'Staff laptop', 'Dell', 'Latitude 3440', 58500, 'Staff room', employees[1]],
    ['LAPTOP', 'Staff laptop', 'HP', 'ProBook 440', 55000, 'IT store', null],
    ['PROJ', 'Classroom projector', 'Epson', 'EB-X51', 42000, 'Room 101', 'LOCATION'],
    ['FURN', 'Teacher desk', 'Godrej', 'Interio T-200', 9500, 'Room 102', null],
  ];
  for (const [i, [cat, name, make, model, purchaseCost, location, assign]] of specs.entries()) {
    const asset = (
      await ctx.api('POST', '/assets', {
        institutionId: inst.id,
        categoryId: cats[cat].id,
        name,
        make,
        model,
        serialNo: `${make.slice(0, 2).toUpperCase()}${inst.code.replace(/[^A-Z0-9]/gi, '')}${1000 + i}`,
        purchaseDate,
        purchaseCost,
        warrantyExpiry: addDays(purchaseDate, 730),
        location,
      })
    ).data;
    bump('assets');
    if (assign === 'LOCATION') {
      await ctx.api('POST', `/assets/${asset.id}/checkout`, {
        targetType: 'LOCATION',
        location,
        assignedAt: addDays(TODAY, -60),
      });
    } else if (assign) {
      await ctx.api('POST', `/assets/${asset.id}/checkout`, {
        targetType: 'EMPLOYEE',
        employeeId: assign.id,
        assignedAt: addDays(TODAY, -60),
        accessories: ['Charger', 'Laptop bag'],
      });
      bump('asset_checkouts');
    }
  }
}

/** Organization policy documents and (optionally) an employee document. */
export async function seedDocuments(ctx, docs) {
  for (const d of docs) {
    const fd = new FormData();
    fd.append(
      'metadata',
      JSON.stringify({
        ownerType: d.ownerType ?? 'organization',
        ...(d.ownerId ? { ownerId: d.ownerId } : {}),
        title: d.title,
        description: d.description ?? null,
        category: d.category ?? 'policy',
        documentType: d.documentType ?? null,
        confidentiality: d.confidentiality ?? 'INTERNAL',
        issueDate: d.issueDate ?? AY_START,
        expiryDate: d.expiryDate ?? null,
      }),
    );
    fd.append('file', pdfBlob(d.title), `${d.title.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`);
    await step(`${ctx.slug} document ${d.title}`, async () => {
      await ctx.api('POST', '/documents/files', fd);
      bump('documents');
    });
  }
}

/**
 * Institution-scoped senders (log type — nothing is really sent): the institution's own email
 * address, SMS sender ID and WhatsApp business number. They win over the organization-wide
 * providers for messages of that institution (institution → group → organization).
 */
export async function seedInstitutionSenders(ctx, inst, { name, email, smsSender, whatsapp }) {
  const existing = await ctx.api('GET', '/communication/providers?pageSize=100');
  const senders = [
    ['email', { from: email, fromName: name }],
    ['sms', { from: smsSender }],
    ['whatsapp', { from: whatsapp }],
  ];
  for (const [channel, config] of senders) {
    const label = `${name} ${channel} (log only)`;
    if (existing.data.some((p) => p.name === label)) continue;
    await step(`${ctx.slug} ${inst.code} ${channel} sender`, () =>
      ctx.api('POST', '/communication/providers', {
        scopeType: 'INSTITUTION',
        targetId: inst.id,
        channel,
        providerType: 'log',
        name: label,
        priority: 5,
        config,
      }),
    );
    bump('institution_senders');
  }
}

/** Log email provider (+ sms/whatsapp when licensed), templates and a sent circular. */
export async function seedCommunication(ctx, { channels = ['email'], recipients, circular }) {
  for (const [i, channel] of channels.entries()) {
    await step(`${ctx.slug} ${channel} provider`, () =>
      ctx.api('POST', '/communication/providers', {
        channel,
        providerType: 'log',
        name: `Demo ${channel} (log only)`,
        priority: 10 + i,
      }),
    );
  }
  await ctx.api('POST', '/communication/templates', {
    key: 'demo.circular',
    channel: 'email',
    name: 'School circular',
    subject: '{{title}}',
    body: 'Dear {{name}},\n\n{{message}}\n\nRegards,\n{{organization}}',
  });
  await ctx.api('POST', '/communication/templates', {
    key: 'demo.fee_reminder',
    channel: 'email',
    name: 'Fee reminder',
    subject: 'Fee reminder: {{installment}}',
    body: 'Dear parent, the fee instalment {{installment}} of {{amount}} is due on {{dueDate}}.',
  });
  bump('message_templates', 2);
  if (recipients.length) {
    await ctx.api('POST', '/communication/messages', {
      channel: 'email',
      subject: circular.subject,
      body: circular.body,
      recipients: recipients.map((userId) => ({ userId })),
    });
    bump('messages_sent', recipients.length);
  }
}
