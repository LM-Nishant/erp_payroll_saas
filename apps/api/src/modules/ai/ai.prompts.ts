import {
  aiDraftKindSchema,
  aiSummaryKindSchema,
  aiToneSchema,
  type AiDraftKind,
} from '@erp/shared';
import { z } from 'zod';
import { registerAiPrompt } from '../../core/ai';

/*
 * Versioned prompt templates of the AI module. Other modules add their own with
 * `registerAiPrompt` in their `<module>.registrations.ts`. Every template has a deterministic
 * `mock()` so the demo works without an external provider.
 */

export const PROMPT_ASSISTANT = 'assistant.chat';
export const PROMPT_DRAFT = 'drafting.document';
export const PROMPT_PAYROLL_ANOMALY = 'payroll.anomaly_explanation';
export const PROMPT_STUDENT_INSIGHT = 'students.insight';
export const PROMPT_SUMMARIZE = 'summarizer.document';

export const ASSISTANT_SYSTEM = [
  'You are "Ask ERP", the assistant of an education ERP + HRMS + payroll product.',
  'Answer ONLY from tool results and the conversation; never invent numbers, names or policies.',
  'Tools are read-only and return only data the current user is permitted to see; if a tool reports a permission problem, say so plainly and do not speculate.',
  'You cannot change data, send messages or approve anything — direct the user to the relevant screen instead.',
  'Be concise; use short bullet lists for figures; amounts are in INR.',
].join('\n');

registerAiPrompt({
  key: PROMPT_ASSISTANT,
  version: 1,
  feature: 'assistant',
  system: ASSISTANT_SYSTEM,
  inputSchema: z.object({ message: z.string() }),
  render: (input) => input.message,
});

/* ---------------------------------------------------------------- drafting */

const draftInputSchema = z.object({
  kind: aiDraftKindSchema,
  instructions: z.string(),
  tone: aiToneSchema,
  variables: z.record(z.union([z.string(), z.number()])),
  organizationName: z.string(),
});
export type DraftPromptInput = z.infer<typeof draftInputSchema>;

const KIND_LABEL: Record<AiDraftKind, string> = {
  offer_letter: 'offer letter',
  experience_letter: 'experience certificate',
  relieving_letter: 'relieving letter',
  circular: 'circular',
  notice: 'notice',
  parent_email: 'email to parents',
  generic: 'document',
};

function v(vars: Record<string, string | number>, key: string, placeholder: string): string {
  const value = vars[key];
  return value === undefined || value === '' ? `{{${placeholder}}}` : String(value);
}

function mockDraft(input: DraftPromptInput): string {
  const vars = input.variables;
  const org = input.organizationName;
  const name = v(vars, 'name', 'recipient.name');
  const greeting = input.tone === 'friendly' ? `Hi ${name},` : `Dear ${name},`;
  const signoff =
    input.tone === 'friendly'
      ? `Warm regards,\n${org}`
      : `Sincerely,\n\nAuthorised Signatory\n${org}`;
  const brief = input.instructions.trim();
  switch (input.kind) {
    case 'offer_letter': {
      const role = v(vars, 'designation', 'designation');
      return [
        `Subject: Offer of appointment — ${role}`,
        '',
        greeting,
        '',
        `We are pleased to offer you the position of ${role} at ${org}. Your expected date of joining is ${v(vars, 'joiningDate', 'joining_date')} and your annual compensation will be ${v(vars, 'ctc', 'ctc')}.`,
        '',
        brief,
        '',
        'Please sign and return a copy of this letter to confirm your acceptance. Detailed terms of employment will be shared at joining.',
        '',
        'We look forward to welcoming you.',
        '',
        signoff,
      ].join('\n');
    }
    case 'experience_letter':
    case 'relieving_letter': {
      const title =
        input.kind === 'experience_letter' ? 'Experience certificate' : 'Relieving letter';
      return [
        `Subject: ${title} — ${name}`,
        '',
        'To whom it may concern,',
        '',
        `This is to certify that ${name} worked with ${org} as ${v(vars, 'designation', 'designation')} from ${v(vars, 'fromDate', 'from_date')} to ${v(vars, 'toDate', 'to_date')}.`,
        input.kind === 'relieving_letter'
          ? `${name} has been relieved of all duties with effect from ${v(vars, 'toDate', 'to_date')}.`
          : `During this period we found ${name} sincere and dependable.`,
        '',
        brief,
        '',
        'We wish them every success in their future endeavours.',
        '',
        signoff,
      ].join('\n');
    }
    case 'circular':
    case 'notice': {
      const title = v(vars, 'title', 'title');
      return [
        `Subject: ${input.kind === 'circular' ? 'Circular' : 'Notice'}: ${title}`,
        '',
        `${input.kind === 'circular' ? 'CIRCULAR' : 'NOTICE'} — ${title}`,
        `Date: ${v(vars, 'date', 'date')}`,
        '',
        'All concerned are hereby informed that:',
        '',
        brief,
        '',
        'Kindly take note and ensure compliance.',
        '',
        signoff,
      ].join('\n');
    }
    case 'parent_email':
      return [
        `Subject: ${v(vars, 'title', 'title')} — update from ${org}`,
        '',
        `Dear Parent/Guardian of ${v(vars, 'studentName', 'student.name')},`,
        '',
        brief,
        '',
        'If you have any questions, please contact the class teacher or the school office.',
        '',
        'Thank you for your continued support.',
        '',
        signoff,
      ].join('\n');
    default:
      return [`Subject: ${brief.slice(0, 60)}`, '', greeting, '', brief, '', signoff].join('\n');
  }
}

registerAiPrompt({
  key: PROMPT_DRAFT,
  version: 1,
  feature: 'drafting',
  system: [
    'You draft professional institutional correspondence for an education group in India.',
    'Return plain text. The FIRST line must be "Subject: <subject>", then a blank line, then the body.',
    'Use only facts provided; where a fact is missing insert a {{placeholder}} variable (lower_snake_case or dotted, e.g. {{recipient.name}}) instead of inventing it.',
    'Never include confidential data such as salaries unless explicitly provided.',
  ].join('\n'),
  inputSchema: draftInputSchema,
  render: (input) =>
    [
      `Draft a ${KIND_LABEL[input.kind]} for ${input.organizationName} in a ${input.tone} tone.`,
      `Instructions: ${input.instructions}`,
      Object.keys(input.variables).length
        ? `Facts: ${Object.entries(input.variables)
            .map(([k, val]) => `${k}=${val}`)
            .join('; ')}`
        : 'Facts: none provided (use placeholders).',
    ].join('\n'),
  mock: mockDraft,
});

/* ---------------------------------------------------------------- payroll anomalies */

const payrollAnomalyInputSchema = z.object({
  runLabel: z.string(),
  institution: z.string().nullable(),
  current: z.object({
    gross: z.number(),
    deductions: z.number(),
    net: z.number(),
    employees: z.number(),
  }),
  previous: z
    .object({ gross: z.number(), deductions: z.number(), net: z.number(), employees: z.number() })
    .nullable(),
  netChangePercent: z.number().nullable(),
  outliers: z.array(
    z.object({
      employee: z.string(),
      currentNet: z.number(),
      previousNet: z.number().nullable(),
      changePercent: z.number().nullable(),
      reasons: z.array(z.string()),
    }),
  ),
});
export type PayrollAnomalyPromptInput = z.infer<typeof payrollAnomalyInputSchema>;

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

registerAiPrompt({
  key: PROMPT_PAYROLL_ANOMALY,
  version: 1,
  feature: 'payroll_anomaly',
  system: [
    'You are a payroll auditor. Explain month-over-month changes of a payroll run to a payroll administrator.',
    'Use only the figures provided. Explain likely causes (headcount change, LOP, arrears, joiners/leavers, revisions) as hypotheses to verify, list the outliers to review, and end with a short checklist.',
  ].join('\n'),
  inputSchema: payrollAnomalyInputSchema,
  render: (i) => JSON.stringify(i),
  mock: (i) => {
    const lines = [
      `Payroll review for ${i.runLabel}${i.institution ? ` (${i.institution})` : ''}:`,
    ];
    if (i.previous) {
      const dEmp = i.current.employees - i.previous.employees;
      lines.push(
        `- Net pay ${inr(i.current.net)} vs ${inr(i.previous.net)} last month (${
          i.netChangePercent === null
            ? 'n/a'
            : `${i.netChangePercent > 0 ? '+' : ''}${i.netChangePercent}%`
        }).`,
        `- Headcount ${i.current.employees} (${dEmp >= 0 ? '+' : ''}${dEmp}); gross ${inr(i.current.gross)}, deductions ${inr(i.current.deductions)}.`,
      );
      if (dEmp !== 0)
        lines.push(
          `- Headcount change explains part of the variance (${Math.abs(dEmp)} ${dEmp > 0 ? 'joiner(s)' : 'leaver(s)'}).`,
        );
    } else {
      lines.push(
        `- No earlier run to compare with; net pay ${inr(i.current.net)} for ${i.current.employees} employee(s).`,
      );
    }
    if (i.outliers.length === 0) {
      lines.push('- No individual outliers above the review threshold.');
    } else {
      lines.push(`- ${i.outliers.length} employee(s) to review:`);
      for (const o of i.outliers.slice(0, 10))
        lines.push(`  • ${o.employee}: ${o.reasons.join('; ')}`);
    }
    lines.push(
      'Checklist: verify LOP/attendance locks, salary revisions and arrears, and new joiners before approval.',
    );
    return lines.join('\n');
  },
});

/* ---------------------------------------------------------------- student insight */

const studentInsightInputSchema = z.object({
  scope: z.string(),
  totals: z.object({ total: z.number(), active: z.number() }),
  signals: z.array(z.object({ label: z.string(), value: z.string() })),
  atRiskCount: z.number(),
  topReasons: z.array(z.object({ reason: z.string(), count: z.number() })),
  dataSources: z.array(z.string()),
});
export type StudentInsightPromptInput = z.infer<typeof studentInsightInputSchema>;

registerAiPrompt({
  key: PROMPT_STUDENT_INSIGHT,
  version: 1,
  feature: 'student_insight',
  system: [
    'You are an academic counsellor assistant. Summarise student-population signals for school leadership.',
    'Use only the aggregates provided (no individual names). Suggest supportive, non-punitive follow-ups. Mention which data sources were available.',
  ].join('\n'),
  inputSchema: studentInsightInputSchema,
  render: (i) => JSON.stringify(i),
  mock: (i) =>
    [
      `Student insight for ${i.scope}: ${i.totals.active} active of ${i.totals.total} students.`,
      ...i.signals.map((s) => `- ${s.label}: ${s.value}`),
      i.atRiskCount
        ? `- ${i.atRiskCount} student(s) flagged for follow-up; most common reasons: ${i.topReasons
            .map((r) => `${r.reason} (${r.count})`)
            .join(', ')}.`
        : '- No students flagged for follow-up.',
      `Data sources used: ${i.dataSources.join(', ')}. Suggested next step: class teachers review flagged students and update guardian contacts.`,
    ].join('\n'),
});

/* ---------------------------------------------------------------- summarizer */

const summarizeInputSchema = z.object({ kind: aiSummaryKindSchema, text: z.string() });

registerAiPrompt({
  key: PROMPT_SUMMARIZE,
  version: 1,
  feature: 'summarizer',
  system: [
    'Summarise the document for an HR reviewer.',
    'Return a 2–3 sentence summary, then a line "Highlights:" followed by up to 6 bullet points starting with "- ".',
    'For resumes: experience, skills, qualifications, notable gaps. For job descriptions: role, must-have skills, experience, responsibilities.',
  ].join('\n'),
  inputSchema: summarizeInputSchema,
  render: (i) => `Document type: ${i.kind}\n\n${i.text}`,
  mock: (i) => {
    const sentences = i.text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.length > 3);
    const lead = sentences.slice(0, 2).join(' ') || i.text.slice(0, 200);
    const keywords = [
      ...new Set(
        (i.text.match(/\b[A-Z][A-Za-z+#.]{2,}\b/g) ?? []).filter(
          (w) => !['The', 'This', 'And', 'For', 'With'].includes(w),
        ),
      ),
    ].slice(0, 6);
    const label = i.kind === 'resume' ? 'Candidate' : i.kind === 'jd' ? 'Role' : 'Document';
    return [
      `${label} summary: ${lead}`,
      'Highlights:',
      ...(keywords.length ? keywords.map((k) => `- ${k}`) : ['- No distinctive keywords found']),
    ].join('\n');
  },
});
