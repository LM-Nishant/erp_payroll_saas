import { z } from 'zod';
import { registerPdfTemplate, renderPdfTemplate, type PdfBlock } from '../../core/pdf';
import { userRefs } from '../academics/academics.access';
import { examTermService } from './exams.service';

/*
 * Report cards: rendered on demand from computed ExamResults with the institution branding
 * (template `report_card`). Staff with exam.view download any card in scope; students /
 * guardians download their own / ward's card once results are published.
 */

export const REPORT_CARD_TEMPLATE = 'report_card';

const reportCardInputSchema = z.object({
  studentName: z.string().max(200),
  admissionNo: z.string().max(64),
  rollNo: z.string().max(32),
  className: z.string().max(200),
  program: z.string().max(200),
  institution: z.string().max(200),
  termName: z.string().max(120),
  academicYear: z.string().max(9),
  subjects: z.array(z.array(z.string().max(120)).length(6)),
  total: z.string(),
  percentage: z.string(),
  grade: z.string(),
  gpa: z.string(),
  cgpa: z.string(),
  rank: z.string(),
  result: z.string(),
  attendance: z.string(),
  classTeacher: z.string().max(200).optional(),
});
type ReportCardInput = z.infer<typeof reportCardInputSchema>;

registerPdfTemplate<ReportCardInput>({
  key: REPORT_CARD_TEMPLATE,
  version: 1,
  name: 'Report card',
  description: 'Term report card with subject marks, grades, GPA/CGPA, rank and attendance.',
  inputSchema: reportCardInputSchema,
  defaultCategory: 'student',
  defaultDocumentType: 'report_card',
  title: (i) => `Report card ${i.termName} ${i.academicYear} - ${i.studentName} (${i.admissionNo})`,
  build(input) {
    const blocks: PdfBlock[] = [
      { type: 'heading', level: 1, text: 'Report card — {{termName}} ({{academicYear}})' },
      {
        type: 'keyValue',
        rows: [
          ['Student', '{{studentName}}'],
          ['Admission no.', '{{admissionNo}}'],
          ['Roll no.', '{{rollNo}}'],
          ['Class / section', '{{className}}'],
          ['Program', '{{program}}'],
          ['Institution', '{{institution}}'],
        ],
      },
      { type: 'heading', level: 2, text: 'Subject-wise performance' },
      {
        type: 'table',
        columns: ['Code', 'Subject', 'Max', 'Pass', 'Marks', 'Grade'],
        rows: input.subjects,
      },
      {
        type: 'keyValue',
        rows: [
          ['Total', '{{total}}'],
          ['Percentage', '{{percentage}}'],
          ['Overall grade', '{{grade}}'],
          ['GPA (this term)', '{{gpa}}'],
          ['CGPA (published terms)', '{{cgpa}}'],
          ['Rank in section', '{{rank}}'],
          ['Result', '{{result}}'],
          ['Attendance', '{{attendance}}'],
        ],
      },
      { type: 'spacer', size: 24 },
      {
        type: 'signature',
        name: input.classTeacher ?? null,
        designation: 'Class teacher',
        label: 'Signature',
      },
      {
        type: 'paragraph',
        text: 'This is a computer-generated report card issued by {{branding.displayName}}.',
      },
    ];
    return blocks;
  },
});

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null ? '—' : n.toFixed(digits).replace(/\.00$/, '');

export async function renderReportCard(termId: string, studentId: string) {
  const data = await examTermService.reportCardData(termId, studentId);
  const { result, student } = data;
  const teacher = data.classTeacherUserId
    ? (await userRefs([data.classTeacherUserId])).get(data.classTeacherUserId)
    : undefined;
  const input: ReportCardInput = {
    studentName: student.displayName,
    admissionNo: student.admissionNo,
    rollNo: student.rollNo ?? '—',
    className: student.classSection.name,
    program: student.program.name,
    institution: data.institution.name,
    termName: data.term.name,
    academicYear: data.term.academicYear,
    subjects: result.subjects.map((s) => [
      s.code,
      s.name,
      String(s.maxMarks),
      String(s.passMarks),
      s.isAbsent ? 'AB' : fmt(s.marks),
      s.grade ?? '—',
    ]),
    total: `${fmt(result.totalMarks)} / ${fmt(result.maxTotal)}`,
    percentage: `${fmt(result.percentage)}%`,
    grade: result.grade ?? '—',
    gpa: fmt(result.gpa),
    cgpa: fmt(data.cgpa),
    rank: result.rank ? String(result.rank) : '—',
    result: result.passed ? 'PASS' : 'NEEDS IMPROVEMENT',
    attendance: data.attendancePercent == null ? '—' : `${fmt(data.attendancePercent)}%`,
    ...(teacher ? { classTeacher: teacher.name } : {}),
  };
  const pdf = await renderPdfTemplate(REPORT_CARD_TEMPLATE, input, data.scope);
  return { body: pdf.body, title: pdf.title };
}
