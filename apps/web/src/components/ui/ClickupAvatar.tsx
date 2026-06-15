import { Avatar, AvatarStack } from './Avatar';
import { useClickupMembers } from '../../hooks/useClickupMembers';

interface ClickupAvatarProps {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  size?: 'sm' | 'md' | 'lg' | number;
}

export function ClickupAvatar({ userId, email, name, size }: ClickupAvatarProps) {
  const { byId, byEmail, byName } = useClickupMembers();
  const m =
    (userId != null ? byId.get(String(userId)) : undefined) ||
    (email ? byEmail.get(email.toLowerCase()) : undefined) ||
    (name ? byName.get(name.toLowerCase()) : undefined) ||
    undefined;
  return (
    <Avatar
      size={size}
      image={m?.profilePicture ?? undefined}
      name={name ?? m?.name ?? email ?? '?'}
    />
  );
}

export interface ClickupPerson { userId?: string | null; email?: string | null; name?: string | null }

export function ClickupAvatarStack({ users, max = 3 }: { users: ClickupPerson[]; max?: number }) {
  const { byId, byEmail, byName } = useClickupMembers();
  const resolved = users.map((u) => {
    const m =
      (u.userId != null ? byId.get(String(u.userId)) : undefined) ||
      (u.email ? byEmail.get(u.email.toLowerCase()) : undefined) ||
      (u.name ? byName.get(u.name.toLowerCase()) : undefined) ||
      undefined;
    return { name: u.name ?? m?.name ?? u.email ?? '?', image: m?.profilePicture ?? undefined };
  });
  return <AvatarStack users={resolved} max={max} />;
}
