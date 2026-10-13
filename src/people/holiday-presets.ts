/**
 * Bangladesh government holidays, offered as a starting list ("Add Bangladesh
 * holidays"). Every date stays editable: the office may not observe all of them.
 *
 * 2026 follows the published government list (general holidays plus executive-
 * order days, without the industrial-area-only election day). 2027 is a
 * projection made before the official list was out: moon-dependent dates are
 * `tentative` until someone confirms them.
 */
export interface HolidayPreset {
  from: string;
  /** Inclusive; equal to `from` for a one-day holiday. */
  to: string;
  name: string;
  tentative: boolean;
}

const fixed = (date: string, name: string): HolidayPreset => ({
  from: date,
  to: date,
  name,
  tentative: false,
});
const moon = (from: string, to: string, name: string): HolidayPreset => ({
  from,
  to,
  name,
  tentative: true,
});

export const BANGLADESH_HOLIDAYS: Record<number, HolidayPreset[]> = {
  2026: [
    fixed('2026-02-04', 'Shab-e-Barat'),
    { from: '2026-02-11', to: '2026-02-12', name: 'National election', tentative: false },
    fixed('2026-02-21', 'Shaheed Day'),
    fixed('2026-03-17', 'Shab-e-Qadr'),
    { from: '2026-03-18', to: '2026-03-23', name: 'Eid-ul-Fitr', tentative: false },
    fixed('2026-03-26', 'Independence Day'),
    fixed('2026-04-14', 'Pohela Boishakh'),
    fixed('2026-05-01', 'May Day and Buddha Purnima'),
    { from: '2026-05-25', to: '2026-05-31', name: 'Eid-ul-Adha', tentative: false },
    fixed('2026-06-26', 'Ashura'),
    fixed('2026-08-05', 'July Mass Uprising Day'),
    fixed('2026-08-26', 'Eid-e-Miladunnabi'),
    fixed('2026-09-04', 'Janmashtami'),
    { from: '2026-10-20', to: '2026-10-22', name: 'Durga Puja', tentative: false },
    fixed('2026-11-07', 'National Revolution and Solidarity Day'),
    fixed('2026-12-16', 'Victory Day'),
    fixed('2026-12-25', 'Christmas Day'),
  ],
  2027: [
    moon('2027-01-24', '2027-01-24', 'Shab-e-Barat'),
    fixed('2027-02-21', 'Shaheed Day'),
    moon('2027-03-05', '2027-03-05', 'Jumatul Wida'),
    moon('2027-03-07', '2027-03-07', 'Shab-e-Qadr'),
    moon('2027-03-09', '2027-03-12', 'Eid-ul-Fitr'),
    fixed('2027-03-26', 'Independence Day'),
    fixed('2027-04-14', 'Pohela Boishakh'),
    fixed('2027-05-01', 'May Day'),
    moon('2027-05-16', '2027-05-19', 'Eid-ul-Adha'),
    moon('2027-05-20', '2027-05-20', 'Buddha Purnima'),
    moon('2027-06-16', '2027-06-16', 'Ashura'),
    fixed('2027-08-05', 'July Mass Uprising Day'),
    moon('2027-08-15', '2027-08-15', 'Eid-e-Miladunnabi'),
    moon('2027-08-25', '2027-08-25', 'Janmashtami'),
    moon('2027-10-08', '2027-10-09', 'Durga Puja'),
    moon('2027-11-07', '2027-11-07', 'National Revolution and Solidarity Day'),
    fixed('2027-12-16', 'Victory Day'),
    fixed('2027-12-25', 'Christmas Day'),
  ],
};
