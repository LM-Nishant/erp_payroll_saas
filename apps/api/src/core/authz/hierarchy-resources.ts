import type { ResourceScope } from './engine';

/** Resource coordinates of the Layer 1 hierarchy entities (and parents for creates). */
export const hierarchyResource = {
  group: (g: { id: string }): ResourceScope => ({ groupId: g.id }),
  institution: (i: { id: string; groupId: string | null }): ResourceScope => ({
    groupId: i.groupId,
    institutionId: i.id,
  }),
  campus: (c: { id: string; institutionId: string }): ResourceScope => ({
    institutionId: c.institutionId,
    campusId: c.id,
  }),
  department: (d: {
    id: string;
    institutionId: string;
    campusId: string | null;
  }): ResourceScope => ({
    institutionId: d.institutionId,
    campusId: d.campusId,
    departmentId: d.id,
  }),
  program: (p: { institutionId: string; departmentId: string }): ResourceScope => ({
    institutionId: p.institutionId,
    departmentId: p.departmentId,
  }),
  classSection: (s: {
    institutionId: string;
    departmentId: string;
    campusId: string | null;
  }): ResourceScope => ({
    institutionId: s.institutionId,
    departmentId: s.departmentId,
    campusId: s.campusId,
  }),
  /** HR employee — current assignment (Layer 6). */
  employee: (e: {
    groupId: string | null;
    institutionId: string;
    campusId: string | null;
    departmentId: string | null;
  }): ResourceScope => ({
    groupId: e.groupId,
    institutionId: e.institutionId,
    campusId: e.campusId,
    departmentId: e.departmentId,
  }),
  student: (s: {
    groupId: string | null;
    institutionId: string;
    campusId: string | null;
    departmentId: string | null;
  }): ResourceScope => ({
    groupId: s.groupId,
    institutionId: s.institutionId,
    campusId: s.campusId,
    departmentId: s.departmentId,
  }),
  admission: (a: {
    groupId: string | null;
    institutionId: string;
    departmentId: string;
  }): ResourceScope => ({
    groupId: a.groupId,
    institutionId: a.institutionId,
    departmentId: a.departmentId,
  }),
  /** Asset (and asset child rows / inventory items carrying the same columns). */
  asset: (a: {
    groupId: string | null;
    institutionId: string;
    campusId: string | null;
    departmentId: string | null;
  }): ResourceScope => ({
    groupId: a.groupId,
    institutionId: a.institutionId,
    campusId: a.campusId,
    departmentId: a.departmentId,
  }),
  /** Library rows (books, copies, loans, reservations, fines) — institution library (+ campus). */
  library: (l: {
    groupId: string | null;
    institutionId: string;
    campusId: string | null;
  }): ResourceScope => ({
    groupId: l.groupId,
    institutionId: l.institutionId,
    campusId: l.campusId,
  }),
};
