import type { ExitTypeValue } from './exit-status';

/**
 * The wording of the two exit letters, as data. Pure: the PDF renderer only lays these lines out,
 * so what a letter SAYS is tested here without touching a PDF. No gendered pronouns: the letters
 * use the employee's name, or the singular "they" where a pronoun is unavoidable.
 */

export type LetterKind = 'experience' | 'release';

export const LETTER_DOC_TYPE: Record<LetterKind, string> = {
  experience: 'EXPERIENCE_LETTER',
  release: 'RELEASE_LETTER',
};

export interface LetterInput {
  kind: LetterKind;
  companyName: string;
  employeeName: string;
  employeeCode: string | null;
  designation: string;
  department: string | null;
  /** `YYYY-MM-DD` */
  joinDate: string;
  /** `YYYY-MM-DD` */
  noticeDate: string;
  /** `YYYY-MM-DD` */
  lastWorkingDay: string;
  exitType: ExitTypeValue;
  /** `YYYY-MM-DD`, the Dhaka date the letter is generated on. */
  issuedOn: string;
}

export interface LetterContent {
  kind: LetterKind;
  docType: string;
  company: string;
  title: string;
  /** e.g. "Date: 7 October 2026" */
  dateLine: string;
  /** e.g. "Ref: Employee code E-014", null when the employee has no code. */
  referenceLine: string | null;
  salutation: string;
  paragraphs: string[];
  closing: string;
  signatory: string[];
  /** The stored file name, e.g. "Experience letter - Ada Lovelace.pdf". */
  fileName: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-10-07` -> `7 October 2026`. A month table, not Intl: ICU data differs between hosts. */
export function formatLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

/** A file name without path separators or other characters that Content-Disposition dislikes. */
function safeName(s: string): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Employee';
}

function releaseOpening(i: LetterInput): string {
  const who = `${i.employeeName} (${i.designation})`;
  const when = `the close of business on ${formatLongDate(i.lastWorkingDay)}`;
  switch (i.exitType) {
    case 'RESIGNATION':
      return `This letter confirms that the resignation of ${who}, notified on ${formatLongDate(i.noticeDate)}, has been accepted and that ${i.employeeName} is released from employment with ${i.companyName} with effect from ${when}.`;
    case 'TERMINATION':
      return `This letter confirms that the employment of ${who} with ${i.companyName} ends with effect from ${when}.`;
    case 'CONTRACT_END':
      return `This letter confirms that the fixed-term engagement of ${who} with ${i.companyName} ends on completion of its term, with effect from ${when}.`;
    case 'OTHER':
      return `This letter confirms that ${who} is released from employment with ${i.companyName} with effect from ${when}.`;
  }
}

export function buildLetter(input: LetterInput): LetterContent {
  const company = input.companyName.trim() || 'The Company';
  const i = { ...input, companyName: company };
  const joined = formatLongDate(i.joinDate);
  const last = formatLongDate(i.lastWorkingDay);
  const base = {
    kind: i.kind,
    docType: LETTER_DOC_TYPE[i.kind],
    company,
    dateLine: `Date: ${formatLongDate(i.issuedOn)}`,
    referenceLine: i.employeeCode ? `Employee code: ${i.employeeCode}` : null,
    closing: 'Yours sincerely,',
    signatory: ['Human Resources', company],
  };

  if (i.kind === 'experience') {
    const dept = i.department ? ` in the ${i.department} department` : '';
    return {
      ...base,
      title: 'Experience Letter',
      salutation: 'To whom it may concern,',
      paragraphs: [
        `This is to certify that ${i.employeeName} was employed by ${company} as ${i.designation}${dept}, from ${joined} to ${last}.`,
        `This letter confirms the dates and the position of that employment.`,
        `We thank ${i.employeeName} for the time spent with us and wish them every success in the future.`,
      ],
      fileName: `Experience letter - ${safeName(i.employeeName)}.pdf`,
    };
  }

  return {
    ...base,
    title: 'Release Letter',
    salutation: `Dear ${i.employeeName},`,
    paragraphs: [
      releaseOpening(i),
      `${i.employeeName} joined ${company} on ${joined}. From the date above, ${i.employeeName} no longer holds any position with, or authority to act on behalf of, ${company}.`,
      `We thank ${i.employeeName} for the contribution made during this time and wish them well.`,
    ],
    fileName: `Release letter - ${safeName(i.employeeName)}.pdf`,
  };
}
