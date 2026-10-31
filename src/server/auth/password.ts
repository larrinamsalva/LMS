// The same maintained Better Auth codec is configured for sign-in, password change and offline recovery.
import { hashPassword, verifyPassword } from "better-auth/crypto";
export const passwordCodec = { hash: hashPassword, verify: verifyPassword };
