// Tenant context, users, hierarchy, academics and students for the demo seed.
import { ACADEMIC_YEAR, AY_START, TEMP_PASSWORD, all, bump, session, step } from './lib.mjs';

/**
 * A tenant context acts inside one organization through a platform tenant-access session
 * (POST /platform/organizations/:id/access), i.e. as the platform super admin.
 */
export async function tenantContext(plat, org, meta) {
  const api = session(
    async () =>
      (
        await plat('POST', `/platform/organizations/${org.id}/access`, {
          reason: 'Seeding the demo environment (scripts/demo/seed-demo.mjs)',
        })
      ).data.accessToken,
    `[${org.slug}]`,
  );
  const roles = await all(api, '/roles');
  return {
    api,
    org,
    slug: org.slug,
    domain: meta.domain,
    meta,
    roleIds: new Map(roles.map((r) => [r.key, r.id])),
    users: [],
    institutions: [],
  };
}

const scopeOf = (s) => (s && s.type !== 'ORGANIZATION' ? { type: s.type, id: s.id } : s);

/** Create (or fetch) a tenant user and record it for the manifest. */
export async function ensureUser(ctx, spec) {
  const email = spec.email.includes('@') ? spec.email : `${spec.email}@${ctx.domain}`;
  const roles = spec.roles.map((r) => {
    const roleId = ctx.roleIds.get(r.key);
    if (!roleId) throw new Error(`Unknown role ${r.key}`);
    return { roleId, scopes: [scopeOf(r.scope ?? { type: 'ORGANIZATION' })] };
  });
  const found = (await ctx.api('GET', `/users?search=${encodeURIComponent(email)}`)).data.find(
    (u) => u.email === email,
  );
  let user = found;
  if (!user) {
    user = (
      await ctx.api('POST', '/users', { email, name: spec.name, password: TEMP_PASSWORD, roles })
    ).data;
    bump('users');
  } else if (spec.setRoles !== false) {
    await ctx.api('PUT', `/users/${user.id}/roles`, { roles });
  }
  const entry = {
    email,
    name: spec.name,
    orgSlug: ctx.slug,
    roleKey: spec.roles[0].key,
    roles: spec.roles.map((r) => ({
      key: r.key,
      scope: r.scope?.type ?? 'ORGANIZATION',
      scopeName: r.scope?.name ?? ctx.org.name,
    })),
    institution: spec.institution?.name ?? null,
    persona: spec.persona ?? null,
    linkedTo: null,
    id: user.id,
  };
  const existing = ctx.users.findIndex((u) => u.email === email);
  if (existing >= 0) ctx.users[existing] = { ...ctx.users[existing], ...entry };
  else ctx.users.push(entry);
  return { ...user, email, entry };
}

export const scope = {
  org: () => ({ type: 'ORGANIZATION' }),
  group: (g) => ({ type: 'GROUP', id: g.id, name: g.name }),
  inst: (i) => ({ type: 'INSTITUTION', id: i.id, name: i.name }),
  dept: (d) => ({ type: 'DEPARTMENT', id: d.id, name: `${d.name} (${d.institutionName})` }),
};

/* ---------------------------------------- Hierarchy ---------------------------------------- */

export async function ensureGroup(ctx, { name, code, description }) {
  const found = (await all(ctx.api, '/groups')).find((g) => g.code === code);
  return found ?? (await ctx.api('POST', '/groups', { name, code, description })).data;
}

export async function ensureInstitution(ctx, body) {
  const list = await all(ctx.api, '/institutions');
  let inst = list.find((i) => i.code === body.code || (body.matchName && i.name === body.name));
  if (!inst) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { matchName, ...input } = body;
    inst = (await ctx.api('POST', '/institutions', input)).data;
  }
  if (!ctx.institutions.some((i) => i.id === inst.id)) ctx.institutions.push(inst);
  return inst;
}

export async function ensureCampus(ctx, inst, { name, code, isMain = true, address }) {
  const found = (await all(ctx.api, `/campuses?institutionId=${inst.id}`)).find(
    (c) => c.code === code || (isMain && c.isMain),
  );
  return (
    found ??
    (await ctx.api('POST', '/campuses', { institutionId: inst.id, name, code, isMain, address }))
      .data
  );
}

export async function ensureDepartments(ctx, inst, campus, defs) {
  const existing = await all(ctx.api, `/departments?institutionId=${inst.id}`);
  const out = {};
  for (const [key, name, code] of defs) {
    let d = existing.find((x) => x.code === code);
    d ??= (
      await ctx.api('POST', '/departments', {
        institutionId: inst.id,
        campusId: campus?.id ?? null,
        name,
        code,
      })
    ).data;
    out[key] = { ...d, institutionName: inst.name };
  }
  return out;
}

/* ---------------------------------------- Academics ---------------------------------------- */

const SUBJECTS = [
  ['ENG', 'English', 'THEORY'],
  ['MATH', 'Mathematics', 'THEORY'],
  ['EVS', 'Environmental Studies', 'THEORY'],
  ['HIN', 'Hindi', 'THEORY'],
  ['CS', 'Computer Lab', 'PRACTICAL'],
];

/**
 * Grades (programs) with sections and subjects. Returns
 * `[{ program, grade, subjects, sections: [section] }]`.
 */
export async function ensureClasses(ctx, inst, dept, campus, { prefix, grades, sections }) {
  const programs = await all(ctx.api, `/programs?institutionId=${inst.id}`);
  const classSections = await all(ctx.api, `/class-sections?institutionId=${inst.id}`);
  const out = [];
  for (const grade of grades) {
    const code = `${prefix}-G${grade}`;
    let program = programs.find((p) => p.code === code);
    program ??= (
      await ctx.api('POST', '/programs', {
        departmentId: dept.id,
        name: `Grade ${grade}`,
        code,
        level: 'PRIMARY',
        durationMonths: 12,
      })
    ).data;
    const subjects = [];
    const existingSubjects = await all(ctx.api, `/subjects?programId=${program.id}`);
    for (const [sc, name, type] of SUBJECTS) {
      const scode = `${code}-${sc}`;
      let s = existingSubjects.find((x) => x.code === scode);
      s ??= (
        await ctx.api('POST', '/subjects', {
          programId: program.id,
          code: scode,
          name,
          type,
          credits: type === 'PRACTICAL' ? 2 : 4,
          maxMarks: 100,
          passMarks: 35,
        })
      ).data;
      subjects.push(s);
      bump('subjects', existingSubjects.includes(s) ? 0 : 1);
    }
    const secs = [];
    for (const letter of sections) {
      const scode = `${code}${letter}`;
      let sec = classSections.find((x) => x.code === scode);
      sec ??= (
        await ctx.api('POST', '/class-sections', {
          programId: program.id,
          campusId: campus?.id ?? null,
          name: `Grade ${grade} - ${letter}`,
          code: scode,
          academicYear: ACADEMIC_YEAR,
          capacity: 40,
        })
      ).data;
      secs.push(sec);
    }
    out.push({ program, grade, subjects, sections: secs });
  }
  bump(
    'class_sections',
    out.reduce((n, c) => n + c.sections.length, 0),
  );
  return out;
}

const FIRST = {
  MALE: [
    'Aarav',
    'Vivaan',
    'Aditya',
    'Arjun',
    'Reyansh',
    'Kabir',
    'Ishaan',
    'Rohan',
    'Dhruv',
    'Kian',
  ],
  FEMALE: ['Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Myra', 'Kiara', 'Ira', 'Meher', 'Navya', 'Riya'],
};
const LAST = [
  'Sharma',
  'Iyer',
  'Reddy',
  'Nair',
  'Gupta',
  'Kulkarni',
  'Mehta',
  'Das',
  'Rao',
  'Joshi',
];
const FATHER = ['Rajesh', 'Sanjay', 'Anil', 'Vikas', 'Prakash', 'Mahesh', 'Sunil', 'Ajay', 'Ravi'];
const MOTHER = ['Sneha', 'Pooja', 'Kavya', 'Lakshmi', 'Anjali', 'Rekha', 'Divya', 'Swati', 'Nisha'];

/**
 * Students spread round-robin over sections. `special` maps a 0-based index to overrides
 * (e.g. `{ userId, guardianEmail }`) so demo logins get real records.
 */
export async function ensureStudents(ctx, sections, count, { seed, special = {} }) {
  const out = [];
  const existing = new Map();
  for (const sec of sections) {
    for (const s of await all(ctx.api, `/students?classSectionId=${sec.id}`)) {
      existing.set(`${s.classSectionId}:${s.rollNo}`, s);
    }
  }
  for (let i = 0; i < count; i++) {
    const sec = sections[i % sections.length];
    const rollNo = String(Math.floor(i / sections.length) + 1);
    const found = existing.get(`${sec.id}:${rollNo}`);
    if (found) {
      out.push(found);
      continue;
    }
    const gender = i % 2 === 0 ? 'MALE' : 'FEMALE';
    const k = (i + seed) % 10;
    const sp = special[i] ?? {};
    const first = sp.first ?? FIRST[gender][(i * 3 + seed) % 10];
    const last = sp.last ?? LAST[k];
    const grade = Number((sec.name.match(/Grade (\d+)/) ?? [0, 3])[1]);
    const phone = `+91 98${String(45_000_000 + seed * 1_000 + i * 37).padStart(8, '0')}`;
    const student = (
      await ctx.api('POST', '/students', {
        classSectionId: sec.id,
        academicYear: ACADEMIC_YEAR,
        rollNo,
        firstName: first,
        lastName: last,
        dateOfBirth: `${2026 - 6 - grade}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
        gender,
        email: sp.email ?? null,
        phone,
        admissionDate: AY_START,
        userId: sp.userId ?? null,
        guardians: [
          {
            name: sp.guardianName ?? `${FATHER[k % FATHER.length]} ${last}`,
            relation: 'FATHER',
            phone: `+91 97${String(31_000_000 + seed * 1_000 + i * 41).padStart(8, '0')}`,
            email: sp.guardianEmail ?? null,
            occupation: 'Engineer',
            isPrimary: true,
            canPickup: true,
          },
          {
            name: `${MOTHER[k % MOTHER.length]} ${last}`,
            relation: 'MOTHER',
            phone: `+91 96${String(52_000_000 + seed * 1_000 + i * 43).padStart(8, '0')}`,
            isPrimary: false,
            canPickup: true,
          },
        ],
      })
    ).data;
    bump('students');
    out.push(student);
  }
  return out;
}

/** Link a guardian of `student` to a parent login (PATCH /students/guardians/:id/login). */
export async function linkGuardian(ctx, student, userId, relation = 'FATHER') {
  const detail = (await ctx.api('GET', `/students/${student.id}`)).data;
  const g = (detail.guardians ?? []).find((x) => (x.relation ?? x.guardian?.relation) === relation);
  const guardianId = g?.guardian?.id ?? g?.guardianId ?? g?.id;
  if (!guardianId) throw new Error(`No ${relation} guardian on ${student.id}`);
  await ctx.api('PATCH', `/students/guardians/${guardianId}/login`, { userId });
  return guardianId;
}

/** Teacher allocations + class teachers + bell schedule + a weekly timetable per section. */
export async function ensureTeaching(ctx, inst, classes, teacherIds) {
  const BELL = [
    { seq: 1, name: 'Period 1', startTime: '08:30', endTime: '09:15', isBreak: false },
    { seq: 2, name: 'Period 2', startTime: '09:15', endTime: '10:00', isBreak: false },
    { seq: 3, name: 'Short break', startTime: '10:00', endTime: '10:15', isBreak: true },
    { seq: 4, name: 'Period 3', startTime: '10:15', endTime: '11:00', isBreak: false },
    { seq: 5, name: 'Period 4', startTime: '11:00', endTime: '11:45', isBreak: false },
    { seq: 6, name: 'Lunch', startTime: '11:45', endTime: '12:25', isBreak: true },
    { seq: 7, name: 'Period 5', startTime: '12:25', endTime: '13:10', isBreak: false },
  ];
  let periods = (await ctx.api('GET', `/timetable/periods?institutionId=${inst.id}`)).data;
  if (!periods.length) {
    periods = (
      await ctx.api('PUT', '/timetable/periods', { institutionId: inst.id, periods: BELL })
    ).data;
  }
  const teaching = periods.filter((p) => !p.isBreak).sort((a, b) => a.seq - b.seq);
  let si = 0;
  for (const cls of classes) {
    for (const sec of cls.sections) {
      const alloc = new Map(
        (await all(ctx.api, `/subject-allocations?classSectionId=${sec.id}`)).map((a) => [
          a.subjectId,
          a.teacherUserId,
        ]),
      );
      for (const [j, subj] of cls.subjects.entries()) {
        if (alloc.has(subj.id)) continue;
        const teacherUserId = teacherIds[(si + j) % teacherIds.length];
        await ctx.api('POST', '/subject-allocations', {
          classSectionId: sec.id,
          subjectId: subj.id,
          teacherUserId,
        });
        alloc.set(subj.id, teacherUserId);
      }
      await step(`class teacher ${sec.code}`, () =>
        ctx.api('PUT', '/subject-allocations/class-teacher', {
          classSectionId: sec.id,
          teacherUserId: teacherIds[si % teacherIds.length],
        }),
      );
      const view = (await ctx.api('GET', `/timetable/sections/${sec.id}`)).data;
      if (!view.entries?.length) {
        const entries = [];
        for (let day = 1; day <= 5; day++) {
          for (const [p, period] of teaching.entries()) {
            const subj = cls.subjects[(day + p + si) % cls.subjects.length];
            entries.push({
              dayOfWeek: day,
              periodId: period.id,
              subjectId: subj.id,
              teacherUserId: alloc.get(subj.id) ?? null,
              room: `Room ${100 + si + 1}`,
            });
          }
        }
        await ctx.api('PUT', `/timetable/sections/${sec.id}`, { entries, allowClashes: true });
        bump('timetables');
      }
      si++;
    }
  }
}
