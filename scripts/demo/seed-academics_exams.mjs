#!/usr/bin/env node
/**
 * Demo seed for the Academics module (subjects, allocation, timetable, student attendance,
 * exams & report cards). HTTP API based and idempotent (upserts by natural keys, skips what
 * already exists), for the ABBS demo organization.
 *
 *   API_URL=http://127.0.0.1:3102 node scripts/demo/seed-academics_exams.mjs
 *
 * For every institution it:
 *  - sets a bell schedule (7 teaching periods + break + lunch) if none exists,
 *  - creates ~6 subjects per program (theory / practical / elective),
 *  - allocates subjects to the institution's teachers (`<inst>.teacherN@abbs.test`) and sets a
 *    class teacher for every section,
 *  - builds a full Mon–Sat weekly timetable per section without teacher double-booking,
 *  - marks daily student attendance for the last 30 days (Sundays skipped),
 *  - creates a default 10-point grading scale, a completed + published "Unit Test 1"
 *    (marks entered, locked, results computed and published → report cards) and a scheduled
 *    "Mid-term".
 * It also creates `aec.coordinator@abbs.test` (academic coordinator of AEC).
 */
const API = (process.env.API_URL ?? 'http://127.0.0.1:3102').replace(/\/+$/, '');
const ORG = 'abbs';
const ADMIN = { email: 'abbs.admin@abbs.test', password: 'Abbs@2026Demo' };
const DEMO_PASSWORD = 'Abbs@2026Demo';
const ATTENDANCE_DAYS = 30;

let token = '';

async function api(method, path, body) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? text}`,
    );
    err.status = res.status;
    err.code = json.error?.code;
    throw err;
  }
  return json;
}

async function listAll(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const json = await api('GET', `${path}${sep}page=${page}&pageSize=100`);
    out.push(...json.data);
    if (!json.meta || out.length >= json.meta.total || json.data.length === 0) return out;
  }
}

/* ---------- deterministic pseudo-random ---------- */
function rand(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ---------- dates ---------- */
const iso = (d) => d.toISOString().slice(0, 10);
const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
/** Next non-Sunday on/after `d`. */
const workday = (d) => (d.getUTCDay() === 0 ? addDays(d, 1) : d);

/* ---------- catalog ---------- */
const CATALOG = [
  {
    match: /grade\s*(\d+)/i,
    subjects: [
      ['ENG', 'English', 'THEORY', 4],
      ['HIN', 'Hindi', 'THEORY', 3],
      ['MATH', 'Mathematics', 'THEORY', 5],
      ['SCI', 'Science', 'THEORY', 5],
      ['SST', 'Social Studies', 'THEORY', 4],
      ['CS', 'Computer Science', 'PRACTICAL', 2],
    ],
  },
  {
    match: /cse|computer science/i,
    subjects: [
      ['DS', 'Data Structures', 'THEORY', 4],
      ['DBMS', 'Database Management Systems', 'THEORY', 4],
      ['OS', 'Operating Systems', 'THEORY', 4],
      ['CN', 'Computer Networks', 'THEORY', 3],
      ['DM', 'Discrete Mathematics', 'THEORY', 3],
      ['DSL', 'Data Structures Lab', 'PRACTICAL', 2],
    ],
  },
  {
    match: /ece|electronics/i,
    subjects: [
      ['SS', 'Signals and Systems', 'THEORY', 4],
      ['AE', 'Analog Electronics', 'THEORY', 4],
      ['DE', 'Digital Electronics', 'THEORY', 4],
      ['EMT', 'Electromagnetic Theory', 'THEORY', 3],
      ['EM', 'Engineering Mathematics', 'THEORY', 3],
      ['EL', 'Electronics Lab', 'PRACTICAL', 2],
    ],
  },
  {
    match: /mba/i,
    subjects: [
      ['ME', 'Managerial Economics', 'THEORY', 3],
      ['FA', 'Financial Accounting', 'THEORY', 3],
      ['MM', 'Marketing Management', 'THEORY', 3],
      ['OB', 'Organizational Behaviour', 'THEORY', 3],
      ['BS', 'Business Statistics', 'THEORY', 3],
      ['BA', 'Business Analytics', 'ELECTIVE', 2],
    ],
  },
  {
    match: /bba/i,
    subjects: [
      ['POM', 'Principles of Management', 'THEORY', 3],
      ['FA', 'Financial Accounting', 'THEORY', 3],
      ['BE', 'Business Economics', 'THEORY', 3],
      ['CF', 'Corporate Finance', 'THEORY', 3],
      ['BC', 'Business Communication', 'THEORY', 2],
      ['XL', 'Spreadsheet Lab', 'PRACTICAL', 2],
    ],
  },
  {
    match: /b\.?com|commerce/i,
    subjects: [
      ['FA', 'Financial Accounting', 'THEORY', 4],
      ['BL', 'Business Law', 'THEORY', 3],
      ['CA', 'Cost Accounting', 'THEORY', 3],
      ['ECO', 'Economics', 'THEORY', 3],
      ['TAX', 'Income Tax', 'ELECTIVE', 3],
      ['TL', 'Accounting Software Lab', 'PRACTICAL', 2],
    ],
  },
];
const FALLBACK = [
  ['ENG', 'English', 'THEORY', 3],
  ['MATH', 'Mathematics', 'THEORY', 4],
  ['SCI', 'General Science', 'THEORY', 3],
  ['GK', 'General Knowledge', 'ELECTIVE', 2],
  ['LAB', 'Practical Lab', 'PRACTICAL', 2],
];
const subjectsFor = (program) =>
  (CATALOG.find((c) => c.match.test(`${program.name} ${program.code}`))?.subjects ?? FALLBACK).map(
    ([code, name, type, credits]) => ({ code, name, type, credits }),
  );

const BELL = [
  { seq: 1, name: 'Period 1', startTime: '08:30', endTime: '09:15', isBreak: false },
  { seq: 2, name: 'Period 2', startTime: '09:15', endTime: '10:00', isBreak: false },
  { seq: 3, name: 'Period 3', startTime: '10:00', endTime: '10:45', isBreak: false },
  { seq: 4, name: 'Short break', startTime: '10:45', endTime: '11:00', isBreak: true },
  { seq: 5, name: 'Period 4', startTime: '11:00', endTime: '11:45', isBreak: false },
  { seq: 6, name: 'Period 5', startTime: '11:45', endTime: '12:30', isBreak: false },
  { seq: 7, name: 'Lunch', startTime: '12:30', endTime: '13:10', isBreak: true },
  { seq: 8, name: 'Period 6', startTime: '13:10', endTime: '13:55', isBreak: false },
  { seq: 9, name: 'Period 7', startTime: '13:55', endTime: '14:40', isBreak: false },
];

const GRADES = [
  { grade: 'A1', minPercent: 91, points: 10, isPass: true },
  { grade: 'A2', minPercent: 81, points: 9, isPass: true },
  { grade: 'B1', minPercent: 71, points: 8, isPass: true },
  { grade: 'B2', minPercent: 61, points: 7, isPass: true },
  { grade: 'C1', minPercent: 51, points: 6, isPass: true },
  { grade: 'C2', minPercent: 41, points: 5, isPass: true },
  { grade: 'D', minPercent: 33, points: 4, isPass: true },
  { grade: 'E', minPercent: 0, points: 0, isPass: false },
];

const stats = {
  subjects: 0,
  allocations: 0,
  timetables: 0,
  attendanceDays: 0,
  papersMarked: 0,
  published: 0,
};

/* ---------- steps ---------- */
async function ensureFeature() {
  const { data } = await api('GET', '/features');
  const f = data.features.find((x) => x.key === 'education');
  if (f && !f.enabled) {
    await api('PUT', '/features/overrides', {
      scopeType: 'ORGANIZATION',
      featureKey: 'education',
      enabled: true,
    });
    console.log('  enabled feature: education');
  }
}

async function ensureBellSchedule(inst) {
  const { data } = await api('GET', `/timetable/periods?institutionId=${inst.id}`);
  if (data.length > 0) return data;
  const res = await api('PUT', '/timetable/periods', { institutionId: inst.id, periods: BELL });
  return res.data;
}

async function ensureSubjects(program) {
  const existing = await listAll(`/subjects?programId=${program.id}`);
  const byCode = new Map(existing.map((s) => [s.code, s]));
  const out = [];
  for (const s of subjectsFor(program)) {
    let row = byCode.get(s.code);
    if (!row) {
      row = (
        await api('POST', '/subjects', {
          programId: program.id,
          code: s.code,
          name: s.name,
          type: s.type,
          credits: s.credits,
          maxMarks: 100,
          passMarks: 35,
        })
      ).data;
      stats.subjects++;
    }
    out.push(row);
  }
  return out;
}

async function ensureAllocations(section, sectionIdx, subjects, teachers) {
  const alloc = new Map();
  if (teachers.length === 0) return alloc;
  const existing = await listAll(`/subject-allocations?classSectionId=${section.id}`);
  const bySubject = new Map(existing.map((a) => [a.subjectId, a]));
  for (const [i, subject] of subjects.entries()) {
    const current = bySubject.get(subject.id);
    if (current) {
      alloc.set(subject.id, current.teacherUserId);
      continue;
    }
    const teacher = teachers[(sectionIdx + i) % teachers.length];
    await api('POST', '/subject-allocations', {
      classSectionId: section.id,
      subjectId: subject.id,
      teacherUserId: teacher.id,
    });
    alloc.set(subject.id, teacher.id);
    stats.allocations++;
  }
  const ct = await api('GET', `/subject-allocations/class-teacher/${section.id}`).catch(() => null);
  if (!ct?.data?.teacherUserId) {
    await api('PUT', '/subject-allocations/class-teacher', {
      classSectionId: section.id,
      teacherUserId: teachers[sectionIdx % teachers.length].id,
    });
  }
  return alloc;
}

async function ensureTimetable(section, sectionIdx, periods, subjects, alloc, busy) {
  const view = (await api('GET', `/timetable/sections/${section.id}`)).data;
  if (view.entries.length > 0) {
    for (const e of view.entries) {
      if (e.teacherUserId) busy.add(`${e.dayOfWeek}:${e.periodId}:${e.teacherUserId}`);
    }
    return;
  }
  const teaching = periods.filter((p) => !p.isBreak).sort((a, b) => a.seq - b.seq);
  const room = `Room ${100 + sectionIdx + 1}`;
  const entries = [];
  for (let day = 1; day <= 6; day++) {
    const slots = day === 6 ? teaching.slice(0, 4) : teaching;
    for (const [p, period] of slots.entries()) {
      const start = (day * 3 + p + sectionIdx) % subjects.length;
      let chosen = null;
      for (let k = 0; k < subjects.length && !chosen; k++) {
        const subject = subjects[(start + k) % subjects.length];
        const teacher = alloc.get(subject.id) ?? null;
        if (!teacher || !busy.has(`${day}:${period.id}:${teacher}`)) chosen = { subject, teacher };
      }
      chosen ??= { subject: subjects[start], teacher: null };
      if (chosen.teacher) busy.add(`${day}:${period.id}:${chosen.teacher}`);
      entries.push({
        dayOfWeek: day,
        periodId: period.id,
        subjectId: chosen.subject.id,
        teacherUserId: chosen.teacher,
        room: chosen.subject.type === 'PRACTICAL' ? `Lab ${(sectionIdx % 3) + 1}` : room,
      });
    }
  }
  try {
    await api('PUT', `/timetable/sections/${section.id}`, { entries, allowClashes: false });
  } catch (e) {
    if (e.code !== 'TIMETABLE_CLASH') throw e;
    // Shared labs may clash across sections: fall back to section rooms.
    for (const e2 of entries) e2.room = room;
    await api('PUT', `/timetable/sections/${section.id}`, { entries, allowClashes: true });
  }
  stats.timetables++;
}

function attendanceStatus(studentId, date) {
  const r = rand(studentId, date);
  // A few students are habitually absent to make the register interesting.
  const weak = rand(studentId) < 0.1;
  if (r < (weak ? 0.2 : 0.05)) return 'ABSENT';
  if (r < (weak ? 0.25 : 0.08)) return 'LATE';
  if (r < (weak ? 0.28 : 0.1)) return 'LEAVE';
  if (r < (weak ? 0.3 : 0.11)) return 'HALF_DAY';
  return 'PRESENT';
}

async function ensureAttendance(section) {
  const today = todayUtc();
  for (let back = ATTENDANCE_DAYS - 1; back >= 0; back--) {
    const d = addDays(today, -back);
    if (d.getUTCDay() === 0) continue;
    const date = iso(d);
    const sheet = (
      await api('GET', `/student-attendance/section?classSectionId=${section.id}&date=${date}`)
    ).data;
    if (sheet.rows.length === 0) return;
    if (sheet.rows.every((r) => r.status)) continue;
    await api('POST', '/student-attendance', {
      classSectionId: section.id,
      date,
      records: sheet.rows.map((r) => ({
        studentId: r.studentId,
        status: r.status ?? attendanceStatus(r.studentId, date),
      })),
      notifyGuardians: back === 0,
    });
    stats.attendanceDays++;
  }
}

async function ensureGradingScale(inst) {
  const { data } = await api('GET', `/exams/grading-scales?institutionId=${inst.id}`);
  const found = data.find((s) => s.name === 'CBSE 10-point');
  if (found) return found;
  return (
    await api('POST', '/exams/grading-scales', {
      institutionId: inst.id,
      name: 'CBSE 10-point',
      bands: GRADES,
      isDefault: true,
    })
  ).data;
}

async function ensureTerm(inst, academicYear, name, type, start, end, scale) {
  const terms = await listAll(`/exams/terms?institutionId=${inst.id}`);
  const found = terms.find((t) => t.name === name && t.academicYear === academicYear);
  if (found) return found;
  return (
    await api('POST', '/exams/terms', {
      institutionId: inst.id,
      name,
      type,
      academicYear,
      startDate: iso(start),
      endDate: iso(end),
      gradingScaleId: scale.id,
    })
  ).data;
}

function examDates(start, count) {
  const out = [];
  let d = workday(start);
  for (let i = 0; i < count; i++) {
    out.push(iso(d));
    d = workday(addDays(d, 1));
  }
  return out;
}

async function scheduleTerm(term, sections, maxMarks, passMarks, start) {
  for (const { section, subjects } of sections) {
    const dates = examDates(start, subjects.length);
    await api('PUT', `/exams/terms/${term.id}/schedules`, {
      schedules: subjects.map((s, i) => ({
        classSectionId: section.id,
        subjectId: s.id,
        examDate: dates[i],
        startTime: '09:30',
        endTime: maxMarks > 50 ? '12:30' : '10:30',
        maxMarks,
        passMarks,
      })),
    });
  }
}

function markFor(studentId, paper) {
  if (rand(studentId, paper.id, 'absent') < 0.03) return { studentId, marks: null, isAbsent: true };
  const ability = 0.35 + rand(studentId, 'ability') * 0.55;
  const noise = (rand(studentId, paper.id) - 0.5) * 0.25;
  const pct = Math.min(1, Math.max(0.1, ability + noise));
  return { studentId, marks: Math.round(pct * paper.maxMarks), isAbsent: false };
}

async function completeUnitTest(term, sections) {
  for (const { section } of sections) {
    const papers = (
      await api('GET', `/exams/terms/${term.id}/schedules?classSectionId=${section.id}`)
    ).data;
    for (const paper of papers) {
      if (paper.marksStatus === 'LOCKED') continue;
      const sheet = (await api('GET', `/exams/schedules/${paper.id}/marks`)).data;
      if (sheet.rows.length > 0) {
        await api('PUT', `/exams/schedules/${paper.id}/marks`, {
          marks: sheet.rows.map((r) => markFor(r.studentId, paper)),
        });
      }
      await api('POST', `/exams/schedules/${paper.id}/lock`, { locked: true });
      stats.papersMarked++;
    }
  }
  await api('POST', `/exams/terms/${term.id}/compute`, {});
  await api('POST', `/exams/terms/${term.id}/publish`);
  stats.published++;
}

async function ensureCoordinator(institutions) {
  const aec = institutions.find((i) => i.code === 'AEC');
  if (!aec) return;
  const email = 'aec.coordinator@abbs.test';
  const users = await listAll('/users');
  if (users.some((u) => u.email === email)) return;
  const roles = await listAll('/roles');
  const role = roles.find((r) => r.key === 'academic_coordinator');
  if (!role) return;
  await api('POST', '/users', {
    email,
    name: 'AEC Academic Coordinator',
    password: DEMO_PASSWORD,
    roles: [{ roleId: role.id, scopes: [{ type: 'INSTITUTION', id: aec.id }] }],
  });
  console.log(`  created ${email}`);
}

async function main() {
  console.log(`Seeding academics demo data via ${API}`);
  const login = await api('POST', '/auth/login', { ...ADMIN, organization: ORG });
  token = login.data.accessToken;
  await ensureFeature();

  const institutions = await listAll('/institutions');
  const programs = await listAll('/programs');
  const sections = await listAll('/class-sections');
  await ensureCoordinator(institutions);

  const today = todayUtc();
  for (const inst of institutions.sort((a, b) => a.code.localeCompare(b.code))) {
    const instSections = sections
      .filter((s) => s.institutionId === inst.id)
      .sort((a, b) => a.code.localeCompare(b.code));
    if (instSections.length === 0) continue;
    console.log(`• ${inst.code}: ${instSections.length} section(s)`);

    const periods = await ensureBellSchedule(inst);
    const prefix = `${inst.code.toLowerCase()}.teacher`;
    const teachers = (
      await api('GET', `/subject-allocations/teacher-options?institutionId=${inst.id}`)
    ).data
      .filter((t) => t.email.startsWith(prefix))
      .sort((a, b) => a.email.localeCompare(b.email));

    const subjectsByProgram = new Map();
    for (const p of programs.filter((x) => x.institutionId === inst.id)) {
      subjectsByProgram.set(p.id, await ensureSubjects(p));
    }

    const busy = new Set();
    const withStudents = [];
    for (const [idx, section] of instSections.entries()) {
      const subjects = subjectsByProgram.get(section.programId) ?? [];
      if (subjects.length === 0) continue;
      const alloc = await ensureAllocations(section, idx, subjects, teachers);
      await ensureTimetable(section, idx, periods, subjects, alloc, busy);
      await ensureAttendance(section);
      const probe = (
        await api(
          'GET',
          `/student-attendance/section?classSectionId=${section.id}&date=${iso(today)}`,
        )
      ).data;
      if (probe.rows.length > 0) withStudents.push({ section, subjects });
    }
    if (withStudents.length === 0) continue;

    const academicYear = instSections[0].academicYear;
    const scale = await ensureGradingScale(inst);
    const utStart = addDays(today, -23);
    const ut = await ensureTerm(
      inst,
      academicYear,
      'Unit Test 1',
      'UNIT_TEST',
      utStart,
      addDays(utStart, 7),
      scale,
    );
    if (ut.status !== 'PUBLISHED') {
      if (ut.status === 'DRAFT' || ut.status === 'SCHEDULED') {
        await scheduleTerm(ut, withStudents, 25, 9, utStart);
      }
      await completeUnitTest(ut, withStudents);
    }

    const mtStart = addDays(today, 26);
    const mt = await ensureTerm(
      inst,
      academicYear,
      'Mid-term',
      'MID_TERM',
      mtStart,
      addDays(mtStart, 8),
      scale,
    );
    if (mt.status === 'DRAFT' || mt.status === 'SCHEDULED') {
      await scheduleTerm(mt, withStudents, 100, 35, mtStart);
    }
  }
  console.log('Done.', stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
