import { hashPassword, verifyPassword } from './password.js';

export function adminRepository(pool) {
  // Missing accounts still perform password derivation to reduce timing differences.
  const dummyHash = hashPassword('dummy-account-password');
  return {
    async authenticateAdmin(username, password) {
      const { rows } = await pool.query(
        'SELECT id, password_hash, is_active FROM admin_users WHERE username = $1', [username]);
      const user = rows[0];
      const valid = await verifyPassword(password, user?.password_hash ?? await dummyHash);
      return valid && user?.is_active ? { id: user.id } : null;
    },
  };
}
