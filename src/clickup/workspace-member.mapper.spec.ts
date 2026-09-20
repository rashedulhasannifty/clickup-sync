import { mapWorkspaceMember } from './workspace-member.mapper';

// A full member as ClickUp returns it from GET /team/{team_id}. Dates arrive as
// millisecond-epoch STRINGS, not numbers, and not every plan sends every field.
const full = {
  user: {
    id: 123,
    username: 'Ada Lovelace',
    email: 'ada@x.com',
    profilePicture: 'https://cdn/ada.png',
    color: '#7B68EE',
    initials: 'AL',
    role: 2,
    last_active: '1758326400000', // 2025-09-20T00:00:00.000Z
    date_joined: '1741737600000', // 2025-03-12T00:00:00.000Z
    date_invited: '1741651200000', // 2025-03-11T00:00:00.000Z
  },
  invited_by: { id: 9, username: 'Sayem', email: 'sayem@x.com' },
};

describe('mapWorkspaceMember', () => {
  it('maps every field ClickUp supplies', () => {
    expect(mapWorkspaceMember(full)).toEqual({
      id: '123',
      name: 'Ada Lovelace',
      email: 'ada@x.com',
      profilePicture: 'https://cdn/ada.png',
      color: '#7B68EE',
      initials: 'AL',
      role: 'admin',
      lastActive: '2025-09-20T00:00:00.000Z',
      dateJoined: '2025-03-12T00:00:00.000Z',
      dateInvited: '2025-03-11T00:00:00.000Z',
      invitedByName: 'Sayem',
    });
  });

  it('returns null for a member with no usable id', () => {
    expect(mapWorkspaceMember({ user: { id: null } })).toBeNull();
    expect(mapWorkspaceMember({ user: {} })).toBeNull();
    expect(mapWorkspaceMember({})).toBeNull();
    expect(mapWorkspaceMember(null)).toBeNull();
  });

  it('nulls every optional field when ClickUp omits them', () => {
    expect(mapWorkspaceMember({ user: { id: '456' } })).toEqual({
      id: '456',
      name: null,
      email: null,
      profilePicture: null,
      color: null,
      initials: null,
      role: null,
      lastActive: null,
      dateJoined: null,
      dateInvited: null,
      invitedByName: null,
    });
  });

  it.each([
    [1, 'owner'],
    [2, 'admin'],
    [3, 'member'],
    [4, 'guest'],
  ])('maps ClickUp role %i to %s', (raw, expected) => {
    expect(mapWorkspaceMember({ user: { id: '1', role: raw } })?.role).toBe(expected);
  });

  it('leaves an unrecognised role code null rather than guessing', () => {
    expect(mapWorkspaceMember({ user: { id: '1', role: 99 } })?.role).toBeNull();
    expect(mapWorkspaceMember({ user: { id: '1', role: 'admin' } })?.role).toBeNull();
  });

  it('accepts numeric epoch dates as well as string ones', () => {
    expect(mapWorkspaceMember({ user: { id: '1', date_joined: 1741737600000 } })?.dateJoined).toBe(
      '2025-03-12T00:00:00.000Z',
    );
  });

  it('nulls dates that are not a usable epoch', () => {
    const m = mapWorkspaceMember({ user: { id: '1', last_active: '', date_joined: 'yesterday', date_invited: 0 } });
    expect(m?.lastActive).toBeNull();
    expect(m?.dateJoined).toBeNull();
    // 0 is ClickUp's "never" sentinel, not the Unix epoch.
    expect(m?.dateInvited).toBeNull();
  });

  it('ignores an invited_by without a username', () => {
    expect(mapWorkspaceMember({ user: { id: '1' }, invited_by: { id: 9 } })?.invitedByName).toBeNull();
    expect(mapWorkspaceMember({ user: { id: '1' }, invited_by: null })?.invitedByName).toBeNull();
  });
});
