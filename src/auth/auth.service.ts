import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Role, User, UserStatus } from '@prisma/client';
import { UserRepository } from './user.repository';
import { OrgRepository, SEED_ORG_ID } from './org.repository';
import { PasswordService } from './password.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly orgs: OrgRepository,
    private readonly passwords: PasswordService,
  ) {}

  /** First-signup claim: create the first OWNER and rename the seed org. */
  async signup(dto: SignupDto): Promise<User> {
    const ownerCount = await this.users.countOwners(SEED_ORG_ID);
    if (ownerCount > 0) {
      throw new ConflictException('Signup is closed — ask an admin for an invitation.');
    }
    const email = dto.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw new ConflictException('An account with this email already exists.');
    }
    await this.orgs.rename(SEED_ORG_ID, dto.orgName.trim());
    const passwordHash = await this.passwords.hash(dto.password);
    return this.users.create({
      email,
      passwordHash,
      name: dto.name.trim(),
      role: Role.OWNER,
      status: UserStatus.ACTIVE,
      org: { connect: { id: SEED_ORG_ID } },
    });
  }

  async login(dto: LoginDto): Promise<User> {
    const generic = new UnauthorizedException('Invalid email or password');
    const user = await this.users.findByEmail(dto.email.toLowerCase());
    if (!user) {
      await this.passwords.verify(dto.password, 'scrypt$16384$8$1$AAAA$AAAA');
      throw generic;
    }
    if (user.status === UserStatus.DISABLED) throw generic;
    if (!(await this.passwords.verify(dto.password, user.passwordHash))) throw generic;
    await this.users.touchLogin(user.id);
    return user;
  }
}
