import type {
  AuthService,
  PasswordHasher,
  TokenService,
  UserStore,
  TokenBlacklistStore,
} from '@kit/auth';

declare global {
  interface Dependencies {
    passwordHasher: PasswordHasher;
    tokenService: TokenService;
    authService: AuthService;
    userStore: UserStore;
    tokenBlacklistStore: TokenBlacklistStore;
  }
}
