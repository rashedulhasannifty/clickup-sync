import PDFDocument from 'pdfkit';
import {
  LETTER_FONT_BOLD,
  LETTER_FONT_REGULAR,
  loadLetterFonts,
} from '../exits/letter-fonts';
import { monthsText, takaText } from './appraisal-header';
import { FORM_RATINGS, GRADE_TABLE, percentText } from './appraisal-score';
import type {
  AppraisalActionValue,
  AppraisalTypeValue,
  AppraisalView,
  FormHeader,
  StepRecord,
} from './appraisals.types';

/**
 * Lays the filled "Performance Appraisal Form – Asst. Managers and above" out
 * on A4 the way the paper form reads: header table, criteria table with the
 * five rating columns, total and grade, the evaluation-metrics table,
 * recommendations, the comment blocks and the CTO/COO decision.
 *
 * Text uses the exit letters' embedded Hind Siliguri (Latin + Bengali), so a
 * Bengali name renders; it throws if the font is missing rather than falling
 * back to Helvetica. What goes on the form is decided by the appraisal view;
 * this only draws it.
 */

const TYPE_LABEL: Record<AppraisalTypeValue, string> = {
  HALF_YEARLY: 'Half Yearly',
  CONFIRMATION: 'Confirmation',
  YEARLY: 'Yearly',
};

export const ACTION_LABEL: Record<AppraisalActionValue, string> = {
  CONFIRM: 'Confirm',
  INCREMENT: 'Increment',
  PROMOTION: 'Promotion',
  TERMINATION: 'Termination',
  DISMISSAL: 'Dismissal',
  TRAINING_TRANSFER: 'Training / Transfer',
};

const ACTION_ORDER: AppraisalActionValue[] = [
  'CONFIRM',
  'INCREMENT',
  'PROMOTION',
  'TERMINATION',
  'DISMISSAL',
  'TRAINING_TRANSFER',
];

const MARGIN = 40;
const LINE = '#888888';
const FAINT = '#555555';

const dateText = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${d} ${months[m - 1]} ${y}`;
};

/** "Appraisal form - Ada Lovelace - H2 2026.pdf" (the documents module sanitises it further). */
export function formPdfFileName(
  view: Pick<AppraisalView, 'employee' | 'cycle'>,
): string {
  return `Appraisal form - ${view.employee.fullName} - ${view.cycle.name}.pdf`;
}

export interface FormPdfInput {
  view: AppraisalView;
  header: FormHeader;
  /** Dhaka date, `YYYY-MM-DD`. */
  generatedOn: string;
}

export function renderAppraisalFormPdf(input: FormPdfInput): Promise<Buffer> {
  const fonts = loadLetterFonts();
  const { view, header } = input;
  const signedOff = view.status === 'SIGNED_OFF';

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `Performance Appraisal Form – ${view.employee.fullName} – ${view.cycle.name}`,
        Author: header.companyName,
        Creator: header.companyName,
      },
    });
    doc.registerFont(LETTER_FONT_REGULAR, fonts[LETTER_FONT_REGULAR]);
    doc.registerFont(LETTER_FONT_BOLD, fonts[LETTER_FONT_BOLD]);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = MARGIN;
    const width = doc.page.width - MARGIN * 2;
    const bottom = () => doc.page.height - MARGIN;
    const regular = (size: number) =>
      doc.font(LETTER_FONT_REGULAR).fontSize(size).fillColor('#000000');
    const bold = (size: number) =>
      doc.font(LETTER_FONT_BOLD).fontSize(size).fillColor('#000000');

    /** Starts a new page when `h` points would run past the bottom margin. */
    const ensure = (h: number) => {
      if (doc.y + h > bottom()) {
        doc.addPage();
        doc.y = MARGIN;
      }
    };

    const checkbox = (x: number, y: number, on: boolean, size = 8) => {
      doc.lineWidth(0.7).rect(x, y, size, size).stroke('#000000');
      if (on) {
        doc
          .lineWidth(1.2)
          .moveTo(x + 1.5, y + size / 2)
          .lineTo(x + size / 2.6, y + size - 1.5)
          .lineTo(x + size - 1.2, y + 1.2)
          .stroke('#000000');
      }
    };

    /** A row of labelled checkboxes, e.g. the appraisal type. */
    const checkRow = (items: { label: string; on: boolean }[], size = 9.5) => {
      ensure(16);
      const y = doc.y;
      let x = left;
      for (const it of items) {
        checkbox(x, y + 2, it.on);
        regular(size).text(it.label, x + 12, y, { lineBreak: false });
        x += 12 + doc.widthOfString(it.label) + 18;
        if (x > left + width - 60) {
          x = left;
          doc.y += 14;
        }
      }
      doc.x = left;
      doc.y = y + 16;
    };

    const sectionTitle = (t: string) => {
      ensure(30);
      doc.y += 6;
      bold(10.5).text(t, left, doc.y, { width });
      doc.y += 2;
    };

    /** A table row: cells laid out left to right, height = tallest cell. */
    const row = (
      cells: {
        text: string;
        w: number;
        bold?: boolean;
        size?: number;
        align?: 'left' | 'center' | 'right';
        fill?: string;
      }[],
      opts: { minH?: number; pad?: number } = {},
    ) => {
      const pad = opts.pad ?? 3;
      const heights = cells.map((c) => {
        (c.bold ? bold : regular)(c.size ?? 8.5);
        return (
          doc.heightOfString(c.text || ' ', { width: c.w - pad * 2 }) + pad * 2
        );
      });
      const h = Math.max(opts.minH ?? 0, ...heights);
      ensure(h);
      const y = doc.y;
      let x = left;
      for (const c of cells) {
        if (c.fill) doc.rect(x, y, c.w, h).fill(c.fill);
        doc.lineWidth(0.5).rect(x, y, c.w, h).stroke(LINE);
        (c.bold ? bold : regular)(c.size ?? 8.5).text(
          c.text,
          x + pad,
          y + pad,
          {
            width: c.w - pad * 2,
            align: c.align ?? 'left',
          },
        );
        x += c.w;
      }
      doc.x = left;
      doc.y = y + h;
      return { y, h };
    };

    const stepOf = (s: StepRecord['status']) =>
      view.steps.find((x) => x.status === s);
    const signature = (s: StepRecord['status']) => {
      const r = stepOf(s);
      if (!r?.at) return '';
      return `${r.byName ?? 'Recorded'} · ${dateText(r.at)}`;
    };

    /** A labelled comment box with an optional "who / when" line underneath. */
    const commentBlock = (title: string, body: string | null, sign = '') => {
      // Title, box and signature line stay together on one page.
      ensure(90);
      sectionTitle(title);
      row([{ text: body?.trim() || ' ', w: width, size: 9 }], {
        minH: 36,
        pad: 5,
      });
      if (sign) {
        regular(7.5)
          .fillColor(FAINT)
          .text(sign, left, doc.y + 2, { width, align: 'right' });
        doc.fillColor('#000000');
      }
    };

    // ── Title ────────────────────────────────────────────────────────────────
    bold(14).text(header.companyName || ' ', left, MARGIN, {
      width,
      align: 'center',
    });
    bold(12).text('Performance Appraisal Form – Asst. Managers and above', {
      width,
      align: 'center',
    });
    regular(9)
      .fillColor(FAINT)
      .text(
        `${view.cycle.name} · review period ${dateText(view.cycle.periodStart)} – ${dateText(view.cycle.periodEnd)}`,
        { width, align: 'center' },
      );
    doc.fillColor('#000000');
    if (!signedOff) {
      bold(9)
        .fillColor('#b00020')
        .text('PREVIEW — not signed off', { width, align: 'center' });
      doc.fillColor('#000000');
    }
    doc.y += 8;

    // ── Appraisal type ───────────────────────────────────────────────────────
    regular(9.5).text('Appraisal type:', left, doc.y);
    doc.y += 2;
    checkRow(
      (['HALF_YEARLY', 'CONFIRMATION', 'YEARLY'] as AppraisalTypeValue[]).map(
        (t) => ({
          label: TYPE_LABEL[t],
          on: view.cycle.type === t,
        }),
      ),
    );

    // ── Header ───────────────────────────────────────────────────────────────
    const half = width / 2;
    const labelW = 120;
    const pairs: [string, string][] = [
      ['Name', header.name],
      ['Concern name', header.concernName ?? '—'],
      ['Designation', header.designation],
      ['Department', header.department ?? '—'],
      ['Date of joining', dateText(header.joinDate)],
      ['Academic qualification', header.academicQualification ?? '—'],
      [
        `Experience in ${header.companyName || 'the company'}`,
        monthsText(header.experienceInCompanyMonths),
      ],
      ['Total years of experience', monthsText(header.totalExperienceMonths)],
      ['Starting salary', takaText(header.startingSalary)],
      ['Present gross salary', takaText(header.grossSalary)],
      ['Last year increment amount', takaText(header.lastIncrementAmount)],
      ['Last promotion date', dateText(header.lastPromotionDate)],
    ];
    for (let i = 0; i < pairs.length; i += 2) {
      const [a, b] = [pairs[i], pairs[i + 1]];
      row([
        { text: a[0], w: labelW, bold: true, fill: '#f2f2f2' },
        { text: a[1], w: half - labelW },
        { text: b[0], w: labelW, bold: true, fill: '#f2f2f2' },
        { text: b[1], w: half - labelW },
      ]);
    }

    // ── Criteria ─────────────────────────────────────────────────────────────
    sectionTitle('Performance criteria');
    regular(8)
      .fillColor(FAINT)
      .text(
        `Rating scale: ${FORM_RATINGS.map((r) => `${r.label} = ${r.value}`).join(', ')}. Rated by the supervisor.`,
        left,
        doc.y,
        { width },
      );
    doc.fillColor('#000000');
    doc.y += 3;
    const slW = 22;
    const rateW = 46;
    const critW = width - slW - rateW * FORM_RATINGS.length;
    const ratingCols = FORM_RATINGS.map((r) => ({
      text: `${r.label}\n(${r.value})`,
      w: rateW,
      bold: true,
      size: 7,
      align: 'center' as const,
      fill: '#f2f2f2',
    }));
    const criteriaHead = () =>
      row([
        { text: 'SL', w: slW, bold: true, align: 'center', fill: '#f2f2f2' },
        { text: 'Criteria', w: critW, bold: true, fill: '#f2f2f2' },
        ...ratingCols,
      ]);
    criteriaHead();
    view.cycle.competencies.forEach((c, i) => {
      const rating = view.leadRatings[c.key];
      const text = c.description ? `${c.label}\n${c.description}` : c.label;
      // Keep a row and its header together across a page break.
      const probe = (() => {
        regular(7.5);
        return doc.heightOfString(text, { width: critW - 6 }) + 10;
      })();
      if (doc.y + probe > bottom()) {
        doc.addPage();
        doc.y = MARGIN;
        criteriaHead();
      }
      const { y, h } = row(
        [
          { text: String(i + 1), w: slW, align: 'center' },
          { text: '', w: critW },
          ...FORM_RATINGS.map(() => ({ text: '', w: rateW })),
        ],
        { minH: probe },
      );
      bold(8.5).text(c.label, left + slW + 3, y + 3, { width: critW - 6 });
      if (c.description)
        regular(7.5)
          .fillColor(FAINT)
          .text(c.description, { width: critW - 6 });
      doc.fillColor('#000000');
      FORM_RATINGS.forEach((r, j) => {
        if (rating === r.value) {
          const cx = left + slW + critW + rateW * j + rateW / 2;
          doc.circle(cx, y + h / 2, 5).fill('#000000');
        }
      });
      doc.x = left;
      doc.y = y + h;
    });

    // ── Total and grade ──────────────────────────────────────────────────────
    const s = view.score;
    const total = s.final === null ? '—' : `${s.final}`;
    row([
      {
        text: 'Total marks',
        w: slW + critW,
        bold: true,
        align: 'right',
        fill: '#f2f2f2',
      },
      { text: `${total} / 100`, w: rateW * 2, bold: true, align: 'center' },
      { text: 'Grade', w: rateW, bold: true, align: 'center', fill: '#f2f2f2' },
      {
        text: s.grade ?? '—',
        w: rateW * 2,
        bold: true,
        align: 'center',
        size: 11,
      },
    ]);
    if (s.criteriaCount !== 10) {
      regular(7.5)
        .fillColor(FAINT)
        .text(
          `${s.criteriaCount} criteria: the total is normalised to 100 (sum ÷ (10 × ${s.criteriaCount}) × 100).`,
          left,
          doc.y + 2,
          { width },
        );
      doc.fillColor('#000000');
    }
    if (s.kpiReference !== null) {
      regular(8)
        .fillColor(FAINT)
        .text(
          `KPI score (reference only, not part of the total): ${s.kpiReference} / 100${s.kpiReferencePartial ? ' (partial: not linked to ClickUp)' : ''}.`,
          left,
          doc.y + 2,
          { width },
        );
      doc.fillColor('#000000');
    }

    // ── Evaluation metrics ───────────────────────────────────────────────────
    sectionTitle('Evaluation metrics');
    const mw = [56, 70, 72, 90, 72, 72, width - 56 - 70 - 72 - 90 - 72 - 72];
    const yes = (b: boolean) => (b ? 'Yes' : '');
    row(
      [
        'Grade',
        'Marks',
        'Promotion',
        'Increment',
        'Training',
        'Transfer',
        'Termination',
      ].map((t, i) => ({
        text: t,
        w: mw[i],
        bold: true,
        align: 'center' as const,
        fill: '#f2f2f2',
      })),
    );
    for (const g of GRADE_TABLE) {
      const on = g.grade === s.grade;
      const fill = on ? '#e3e3e3' : undefined;
      row(
        [
          g.grade,
          `${g.minMarks}–${g.maxMarks}`,
          g.promotion ? 'YES' : '',
          g.incrementMax === 0
            ? '0%'
            : g.incrementMin === g.incrementMax
              ? `${g.incrementMin}%`
              : `${g.incrementMin}–${g.incrementMax}%`,
          yes(g.training),
          yes(g.transfer),
          yes(g.termination),
        ].map((t, i) => ({
          text: t,
          w: mw[i],
          align: 'center' as const,
          bold: on,
          fill,
        })),
      );
    }
    ensure(40);
    regular(7.5).fillColor(FAINT);
    doc.y += 2;
    doc.text(
      'A: proposed for promotion (eligible if the next position is vacant). B, C, D: proposed for service confirmation.',
      left,
      doc.y,
      { width },
    );
    doc.text(
      'E: proposed for increment with a training plan (extension of probation). F: proposed for possible transfer with a development plan, or separation.',
      { width },
    );
    doc.fillColor('#000000');

    // ── Recommendations ──────────────────────────────────────────────────────
    sectionTitle('Recommendations by Supervisor / Department Head');
    checkRow(
      ACTION_ORDER.map((a) => ({
        label: ACTION_LABEL[a],
        on: view.actions.includes(a),
      })),
    );
    const extras: string[] = [];
    if (view.actions.includes('INCREMENT') && view.incrementPercent !== null)
      extras.push(`Proposed increment: ${percentText(view.incrementPercent)}`);
    if (view.actions.includes('PROMOTION') && view.newDesignation)
      extras.push(`Proposed designation: ${view.newDesignation}`);
    if (extras.length) {
      regular(9).text(extras.join('    '), left, doc.y, { width });
    }

    // ── Comment blocks ───────────────────────────────────────────────────────
    commentBlock(
      "Supervisor's comments (specifically mention salary raise and promotion, if any)",
      view.leadComment,
      signature('LEAD_REVIEW'),
    );
    commentBlock(
      'Department Head comments',
      view.deptHeadComment,
      signature('DEPT_HEAD_REVIEW'),
    );
    commentBlock(
      'Training need / development plan (if any)',
      view.trainingPlan,
    );
    commentBlock(
      'HR department comments',
      view.hrComment,
      signature('HR_REVIEW'),
    );

    ensure(100);
    sectionTitle('Approval & comments by CTO/COO');
    checkRow([
      { label: 'Approved', on: view.approvalDecision === 'APPROVED' },
      { label: 'NOT Approved', on: view.approvalDecision === 'NOT_APPROVED' },
    ]);
    row([{ text: view.approvalComment?.trim() || ' ', w: width, size: 9 }], {
      minH: 36,
      pad: 5,
    });
    const approval = signature('FINAL_APPROVAL');
    if (approval) {
      regular(7.5)
        .fillColor(FAINT)
        .text(approval, left, doc.y + 2, { width, align: 'right' });
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    ensure(24);
    doc.y += 10;
    regular(7.5)
      .fillColor(FAINT)
      .text(
        signedOff
          ? `Signed off ${dateText(view.signedOffAt)}. Generated ${dateText(input.generatedOn)}.`
          : `Preview generated ${dateText(input.generatedOn)}; the appraisal is at ${view.status.replace(/_/g, ' ').toLowerCase()}.`,
        left,
        doc.y,
        { width, align: 'center' },
      );

    doc.end();
  });
}
