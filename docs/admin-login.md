# Admin frontend login

Admin usernames and salted scrypt password hashes are stored in PostgreSQL's `admin_users` table. Login no longer reads `ADMIN_USERNAME` or `ADMIN_PASSWORD` from `.env`; remove those entries if present. Never embed credentials or `ADMIN_API_KEY` in frontend source code.

Run the following in your terminal to apply migration 010 and create an account:

```powershell
npm run db:migrate
npm run admin:create -- admin
```

The account command asks for a password and confirmation with hidden input. Use at least 12 characters. It inserts a new account and rejects duplicate usernames; it never resets an existing account. No default account or password is seeded. The login form collects the administrator's credentials. Restart the API after deploying the updated code.

Send `POST /api/v1/admin/login` (also available at `/api/admin/login`) with `Content-Type: application/json`:

```json
{ "username": "admin", "password": "your-password" }
```

Successful response:

```json
{ "access_token": "opaque-session-token", "refresh_token": "opaque-refresh-token", "token_type": "Bearer", "expires_in": 3600, "refresh_expires_in": 604800 }
```

Send `Authorization: Bearer <access_token>` on protected API requests. Access tokens expire after one hour. Keep both tokens in frontend memory and clear both when signing out; local sign-out does not revoke server sessions.

To renew an expired access token, send `POST /api/v1/admin/refresh` (also `/api/admin/refresh`) with `Content-Type: application/json`:

```json
{ "refresh_token": "opaque-refresh-token" }
```

The response has the same fields as login. Replace both stored tokens: refresh tokens are single-use, and renewal revokes the previous access token. The refresh session expires seven days after the original login; renewal does not extend that deadline. `refresh_expires_in` reports the remaining seconds. Only one refresh request should run at a time. On refresh 401, clear both tokens and show the login form. Refresh returns 400 for invalid bodies and 415 for non-JSON requests; the normal API rate limit applies. Login and refresh responses disable caching.

Sessions live in the API process and disappear on restart. Multiple replicas require sticky routing or a shared session implementation. Existing server-side `ADMIN_API_KEY` authentication still works. Production startup still requires that key.

Login errors: 400 invalid request, 401 incorrect credentials or inactive/missing account, 415 missing JSON content type, 429 more than 10 attempts per IP in 15 minutes (shared across aliases), 503 admin database integration not configured. Both fields are required. Existing CORS origins in `src/app.js` apply to both endpoints. Set `is_active = FALSE` to prevent new logins; already issued access and refresh sessions remain valid until expiry or server restart. At most 1000 access tokens and 1000 refresh sessions are retained; issuing more evicts the oldest entries.
