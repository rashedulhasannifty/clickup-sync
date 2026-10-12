import { isValidDocType } from '../documents/document-catalog';
import {
  DEFAULT_ONBOARDING_ITEMS,
  SUGGESTED_DOCUMENT,
  defaultOnboardingRows,
  progressOf,
  resolveItemChange,
  resolveLinkedDocument,
} from './onboarding-checklist';

const NOW = new Date('2026-10-12T05:00:00Z');
const open = { done: false, notApplicable: false, documentId: null };

describe('default joining checklist', () => {
  it('follows the paper form: 10 documents, 7 equipment, 8 accounts, 3 welcome — 28 lines, unique keys', () => {
    const count = (g: string) =>
      DEFAULT_ONBOARDING_ITEMS.filter((i) => i.group === g).length;
    expect([
      count('DOCUMENTS'),
      count('EQUIPMENT'),
      count('ACCOUNTS'),
      count('WELCOME'),
    ]).toEqual([10, 7, 8, 3]);
    const keys = DEFAULT_ONBOARDING_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(28);
  });

  it('numbers positions in form order', () => {
    const rows = defaultOnboardingRows();
    expect(rows.map((r) => r.position)).toEqual([...Array(28).keys()]);
    expect(rows[0]).toMatchObject({ key: 'doc_resume', group: 'DOCUMENTS' });
  });

  it('suggests a document for every DOCUMENTS item, and every suggestion is valid in the catalog (else the pre-filled upload 400s)', () => {
    for (const i of DEFAULT_ONBOARDING_ITEMS.filter(
      (x) => x.group === 'DOCUMENTS',
    )) {
      const s = SUGGESTED_DOCUMENT[i.key];
      expect(s).toBeDefined();
      expect(isValidDocType(s.category, s.docType)).toBe(true);
    }
    expect(SUGGESTED_DOCUMENT.doc_nominee_nid.category).toBe('NOMINEE');
    expect(SUGGESTED_DOCUMENT.doc_nominee_photos.category).toBe('NOMINEE');
    expect(SUGGESTED_DOCUMENT.doc_nid_passport.category).toBe('IDENTITY');
    expect(SUGGESTED_DOCUMENT.doc_education.category).toBe('EDUCATION');
    expect(SUGGESTED_DOCUMENT.doc_photos.category).toBe('PERSONAL');
    for (const k of [
      'doc_resume',
      'doc_job_application',
      'doc_release_letter',
      'doc_experience',
      'doc_salary_certificate',
    ])
      expect(SUGGESTED_DOCUMENT[k].category).toBe('EMPLOYMENT');
  });
});

describe('resolveItemChange: done and N/A are exclusive', () => {
  it('refuses both at once', () => {
    expect(
      resolveItemChange(open, { done: true, notApplicable: true }, 'u', NOW),
    ).toEqual({
      ok: false,
      error: expect.stringMatching(/both/),
    });
  });

  it('ticking done records who/when and clears N/A', () => {
    const r = resolveItemChange(
      { ...open, notApplicable: true },
      { done: true },
      'u',
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      write: {
        done: true,
        doneBy: 'u',
        doneAt: NOW,
        notApplicable: false,
        notApplicableBy: null,
        notApplicableAt: null,
      },
    });
  });

  it('marking N/A clears done and drops a linked document', () => {
    const r = resolveItemChange(
      { done: true, notApplicable: false, documentId: 'd1' },
      { notApplicable: true },
      'u',
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      write: {
        notApplicable: true,
        notApplicableBy: 'u',
        notApplicableAt: NOW,
        done: false,
        doneBy: null,
        doneAt: null,
        documentId: null,
      },
    });
  });

  it('re-ticking an item already done keeps the original who/when', () => {
    expect(
      resolveItemChange({ ...open, done: true }, { done: true }, 'other', NOW),
    ).toEqual({ ok: true, write: {} });
  });

  it('unticking done also drops the link, so a linked document always means done', () => {
    expect(
      resolveItemChange(
        { done: true, notApplicable: false, documentId: 'd1' },
        { done: false },
        'u',
        NOW,
      ),
    ).toEqual({
      ok: true,
      write: { done: false, doneBy: null, doneAt: null, documentId: null },
    });
  });

  it('linking a document marks the item done and clears N/A', () => {
    expect(
      resolveItemChange(
        { ...open, notApplicable: true },
        { documentId: 'd2' },
        'u',
        NOW,
      ),
    ).toEqual({
      ok: true,
      write: {
        done: true,
        doneBy: 'u',
        doneAt: NOW,
        notApplicable: false,
        notApplicableBy: null,
        notApplicableAt: null,
        documentId: 'd2',
      },
    });
  });

  it('refuses a link together with N/A or with done=false', () => {
    expect(
      resolveItemChange(
        open,
        { documentId: 'd', notApplicable: true },
        'u',
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      resolveItemChange(open, { documentId: 'd', done: false }, 'u', NOW).ok,
    ).toBe(false);
  });

  it('unlinking leaves done alone', () => {
    expect(
      resolveItemChange(
        { done: true, notApplicable: false, documentId: 'd1' },
        { documentId: null },
        'u',
        NOW,
      ),
    ).toEqual({
      ok: true,
      write: { documentId: null },
    });
  });

  it('a machine actor is stored as null', () => {
    const r = resolveItemChange(open, { notApplicable: true }, null, NOW);
    expect(r.ok && r.write.notApplicableBy).toBeNull();
  });
});

describe('progressOf', () => {
  it('counts done and N/A as resolved', () => {
    expect(
      progressOf([
        { done: true, notApplicable: false },
        { done: false, notApplicable: true },
        { done: false, notApplicable: false },
      ]),
    ).toEqual({ resolved: 2, total: 3 });
    expect(progressOf([])).toEqual({ resolved: 0, total: 0 });
  });
});

describe('resolveLinkedDocument', () => {
  const doc = (
    id: string,
    replacedById: string | null = null,
    deletedAt: Date | null = null,
  ) => ({ id, replacedById, deletedAt });

  it('follows replacements to the current version', () => {
    const byId = new Map([
      ['a', doc('a', 'b')],
      ['b', doc('b', 'c')],
      ['c', doc('c')],
    ]);
    expect(resolveLinkedDocument('a', byId)).toEqual({
      status: 'linked',
      document: doc('c'),
    });
  });

  it('reports a deleted or unknown document as removed, and no link as none', () => {
    expect(
      resolveLinkedDocument('a', new Map([['a', doc('a', null, NOW)]])),
    ).toEqual({ status: 'removed' });
    expect(resolveLinkedDocument('zz', new Map())).toEqual({
      status: 'removed',
    });
    expect(resolveLinkedDocument(null, new Map())).toEqual({ status: 'none' });
  });

  it('terminates on a malformed version loop', () => {
    const byId = new Map([
      ['a', doc('a', 'b')],
      ['b', doc('b', 'a')],
    ]);
    expect(resolveLinkedDocument('a', byId).status).toBe('linked');
  });
});
