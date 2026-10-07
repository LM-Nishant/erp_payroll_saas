/** Pure timetable helpers (clash detection). */

export interface ClashCell {
  classSectionId: string;
  dayOfWeek: number;
  periodId: string;
  teacherUserId?: string | null;
  room?: string | null;
}

export interface Clash {
  kind: 'TEACHER' | 'ROOM';
  dayOfWeek: number;
  periodId: string;
  key: string;
  classSectionIds: string[];
}

const normalizeRoom = (room: string) => room.trim().toUpperCase();

/**
 * Find teacher and room double-bookings among `cells` (a teacher or room used by more than one
 * section in the same day × period slot). `cells` should include the proposed entries of the
 * edited section plus the existing entries of every other section of the institution.
 */
export function detectClashes(cells: readonly ClashCell[]): Clash[] {
  const buckets = new Map<string, Clash>();
  const add = (kind: Clash['kind'], key: string, cell: ClashCell) => {
    const id = `${kind}|${cell.dayOfWeek}|${cell.periodId}|${key}`;
    const bucket = buckets.get(id) ?? {
      kind,
      dayOfWeek: cell.dayOfWeek,
      periodId: cell.periodId,
      key,
      classSectionIds: [],
    };
    if (!bucket.classSectionIds.includes(cell.classSectionId)) {
      bucket.classSectionIds.push(cell.classSectionId);
    }
    buckets.set(id, bucket);
  };
  for (const cell of cells) {
    if (cell.teacherUserId) add('TEACHER', cell.teacherUserId, cell);
    if (cell.room && cell.room.trim()) add('ROOM', normalizeRoom(cell.room), cell);
  }
  return [...buckets.values()]
    .filter((b) => b.classSectionIds.length > 1)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.kind.localeCompare(b.kind));
}

/** ISO day of week (1 = Monday … 7 = Sunday) of a YYYY-MM-DD date. */
export function isoDayOfWeek(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
