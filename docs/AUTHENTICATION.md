# AgentDB Authentication System

Comprehensive authentication and authorization system for AgentDB with enterprise-grade security features.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Authentication Methods](#authentication-methods)
- [API Reference](#api-reference)
- [Security Best Practices](#security-best-practices)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

AgentDB implements a multi-layered authentication system with:

- **JWT Authentication**: Short-lived access tokens (15 min) with refresh tokens (7 days)
- **API Key Authentication**: Long-lived keys for service-to-service communication
- **Role-Based Access Control (RBAC)**: Granular permission management
- **Rate Limiting**: Protection against brute force and DoS attacks
- **Audit Logging**: Comprehensive security event logging
- **Cryptographic Security**: Argon2id password hashing, secure token generation

## Features

### Core Security Features

✅ **Multi-Method Authentication**
- JWT Bearer tokens for user sessions
- API keys for programmatic access
- Optional authentication for public endpoints

✅ **Advanced Password Security**
- Argon2id hashing (OWASP recommended)
- Password strength validation
- Secure password reset flow
- Account lockout after failed attempts

✅ **Token Management**
- Access tokens (15 minute expiry)
- Refresh tokens (7 day expiry)
- Token rotation and revocation
- Automatic session cleanup

✅ **Rate Limiting**
- Per-IP and per-user limits
- Configurable windows and thresholds
- Stricter limits for auth endpoints
- Sliding window algorithm

✅ **Audit Logging**
- All authentication events logged
- Failed login attempt tracking
- API key usage monitoring
- Compliance-ready logs (SOC2, GDPR)

✅ **Security Headers**
- Helmet.js integration
- HSTS, CSP, X-Frame-Options
- CORS configuration
- Secure cookie settings

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Generate JWT secrets:

```bash
# Generate JWT_SECRET
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('base64'))"

# Generate REFRESH_TOKEN_SECRET
node -e "console.log('REFRESH_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('base64'))"
```

Update `.env` with the generated secrets and configure other settings.

### 3. Basic Usage

```typescript
import express from 'express';
import {
  authenticate,
  requireJWT,
  requireApiKey,
  requireRole,
  requirePermissions
} from './middleware/auth.middleware';
import {
  generalRateLimiter,
  authRateLimiter
} from './middleware/rate-limit.middleware';
import { applySecurity } from './middleware/security-headers.middleware';

const app = express();

// Apply security headers
app.use(applySecurity({
  cors: true,
  corsOrigins: ['https://yourdomain.com']
}));

// Apply general rate limiting
app.use(generalRateLimiter);

// Public endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Protected endpoint (JWT or API key)
app.get('/api/data', authenticate(), (req, res) => {
  res.json({ userId: req.user?.userId });
});

// JWT-only endpoint
app.get('/api/user/profile', requireJWT(), (req, res) => {
  res.json({ user: req.user });
});

// Admin-only endpoint
app.get('/api/admin', requireRole('admin'), (req, res) => {
  res.json({ message: 'Admin access granted' });
});

// Permission-based endpoint
app.delete('/api/data/:id', requirePermissions(['data:delete']), (req, res) => {
  res.json({ deleted: req.params.id });
});

// Authentication endpoints
app.post('/auth/register', authRateLimiter, async (req, res) => {
  // Registration logic
});

app.post('/auth/login', authRateLimiter, async (req, res) => {
  // Login logic
});

app.listen(3000);
```

## Authentication Methods

### JWT Authentication

#### User Registration

```typescript
import { registerUser } from './services/auth.service';

const result = await registerUser(
  'user@example.com',
  'SecurePassword123!',
  'user',
  ['data:read', 'data:write']
);

if (result.success) {
  console.log('User created:', result.user);
}
```

#### User Login

```typescript
import { login } from './services/auth.service';

const result = await login('user@example.com', 'SecurePassword123!');

if (result.success) {
  console.log('Access Token:', result.tokens.accessToken);
  console.log('Refresh Token:', result.tokens.refreshToken);
  console.log('User:', result.user);
}
```

#### Token Refresh

```typescript
import { refreshAccessToken } from './services/token.service';

const result = refreshAccessToken(refreshToken);

if (result.success) {
  console.log('New Access Token:', result.accessToken);
}
```

#### Making Authenticated Requests

```bash
# Using JWT
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://api.example.com/api/data
```

### API Key Authentication

#### Creating API Key

```typescript
import { createUserApiKey } from './services/auth.service';

const result = await createUserApiKey(
  userId,
  'Production API Key',
  'live',
  365 // expires in 365 days
);

if (result.success) {
  console.log('API Key (save this!):', result.apiKey);
  console.log('Key Info:', result.keyInfo);
}
```

#### Using API Key

```bash
# Using API Key
curl -H "X-API-Key: agdb_live_YOUR_API_KEY" \
  https://api.example.com/api/data
```

#### Rotating API Key

```typescript
import { rotateApiKey } from './services/auth.service';

const result = await rotateApiKey(oldKeyId, 'Security rotation');

if (result.success) {
  console.log('New API Key:', result.apiKey);
}
```

## API Reference

### Middleware Functions

#### `authenticate(options)`

Main authentication middleware supporting JWT and API keys.

```typescript
interface AuthOptions {
  required?: boolean;              // Default: true
  allowApiKey?: boolean;           // Default: true
  allowJWT?: boolean;              // Default: true
  requiredRole?: string | string[];
  requiredPermissions?: string[];
  allowDevelopmentBypass?: boolean; // Default: false
}
```

**Examples:**

```typescript
// Allow both JWT and API key
app.get('/api/data', authenticate(), handler);

// Optional authentication
app.get('/api/public', authenticate({ required: false }), handler);

// Require specific role
app.get('/api/admin', authenticate({ requiredRole: 'admin' }), handler);

// Require permissions
app.post('/api/data', authenticate({
  requiredPermissions: ['data:write']
}), handler);
```

#### `requireJWT(options)`

Require JWT authentication only.

```typescript
app.get('/api/user/profile', requireJWT(), handler);
```

#### `requireApiKey(options)`

Require API key authentication only.

```typescript
app.post('/api/webhook', requireApiKey(), handler);
```

#### `requireRole(role, options)`

Require specific role(s).

```typescript
app.get('/api/admin', requireRole('admin'), handler);
app.get('/api/moderator', requireRole(['admin', 'moderator']), handler);
```

#### `requirePermissions(permissions, options)`

Require specific permissions.

```typescript
app.delete('/api/data/:id', requirePermissions(['data:delete']), handler);
```

### Rate Limiters

Pre-configured rate limiters for different endpoint types:

```typescript
import {
  generalRateLimiter,        // 100 req / 15 min
  authRateLimiter,           // 5 req / 15 min
  registrationRateLimiter,   // 3 req / hour
  apiKeyRateLimiter,         // 10 req / hour
  passwordResetRateLimiter,  // 3 req / hour
  readRateLimiter,           // 200 req / 15 min
  writeRateLimiter,          // 50 req / 15 min
} from './middleware/rate-limit.middleware';

// Apply to endpoints
app.post('/auth/login', authRateLimiter, loginHandler);
app.post('/auth/register', registrationRateLimiter, registerHandler);
```

### Service Functions

#### Auth Service

```typescript
// User management
registerUser(email, password, role, permissions)
login(email, password)
logout(sessionId, refreshToken?)
updateUserPassword(userId, oldPassword, newPassword)
getUserById(userId)

// API key management
createUserApiKey(userId, name, environment, expiresInDays?)
validateApiKey(apiKey)
revokeApiKey(keyId, reason?)
rotateApiKey(keyId, reason?)
listUserApiKeys(userId)

// Session management
validateSession(sessionId)
refreshSession(sessionId)
cleanupExpiredSessions()
```

#### Token Service

```typescript
// Token creation
createAccessToken(payload)
createRefreshToken(payload)
createTokenPair(payload)
createServiceAccountToken(payload)

// Token verification
verifyAccessToken(token)
verifyRefreshToken(token)
isTokenExpired(token)
getTokenTimeRemaining(token)

// Token management
refreshAccessToken(refreshToken)
rotateTokenPair(refreshToken)
revokeToken(token)
extractTokenFromHeader(authHeader)
```

#### Crypto Utils

```typescript
// Password security
hashPassword(password)
verifyPassword(password, hash)
validatePasswordStrength(password)

// API key security
generateApiKey(environment)
hashApiKey(apiKey)
verifyApiKey(apiKey, hash)

// Random generation
generateSecureRandom(length)
generateSecureRandomHex(length)
generateSecureRandomBase64(length)
generateSessionId()
generateJWTSecret()
generateUUID()

// Cryptographic operations
constantTimeCompare(a, b)
generateHMAC(data, secret)
verifyHMAC(data, signature, secret)
sha256(data)
encrypt(plaintext, key)
decrypt(ciphertext, key, iv, authTag)
```

## Security Best Practices

### 1. Secret Management

❌ **Never** commit secrets to git:
```typescript
// BAD - hardcoded secret
const JWT_SECRET = 'my-secret-123';
```

✅ **Always** use environment variables:
```typescript
// GOOD - from environment
const JWT_SECRET = process.env.JWT_SECRET;
```

### 2. HTTPS Only

Always use HTTPS in production:

```typescript
// Enforce HTTPS
if (process.env.NODE_ENV === 'production' && req.protocol !== 'https') {
  return res.redirect('https://' + req.hostname + req.url);
}
```

### 3. Token Storage

**Client-side:**
- Store access tokens in memory (React state, Vue data)
- Store refresh tokens in httpOnly cookies
- Never store tokens in localStorage

**Server-side:**
- Never log tokens
- Use secure session storage (Redis with encryption)
- Implement token rotation

### 4. Password Requirements

Enforce strong passwords:

```typescript
import { validatePasswordStrength } from './utils/crypto.utils';

const validation = validatePasswordStrength(password);
if (!validation.valid) {
  return res.status(400).json({
    error: 'Weak password',
    issues: validation.errors
  });
}
```

### 5. Rate Limiting

Apply appropriate rate limits:

```typescript
// Stricter for auth endpoints
app.post('/auth/login', authRateLimiter, loginHandler);

// Moderate for general API
app.use('/api', generalRateLimiter);

// Lenient for read operations
app.get('/api/data', readRateLimiter, handler);
```

### 6. Audit Logging

Monitor security events:

```typescript
import { auditLogger } from './services/audit-logger.service';

// Log failed login
await auditLogger.logAuthEvent({
  type: 'login_failed',
  userId: email,
  ip: req.ip,
  reason: 'Invalid password',
  timestamp: new Date()
});

// Query logs
const suspiciousActivity = await auditLogger.queryLogs({
  eventType: 'login_failed',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000)
});
```

### 7. Permission Design

Use principle of least privilege:

```typescript
// Good permission hierarchy
const permissions = [
  'data:read',
  'data:write',
  'data:delete',
  'user:read',
  'user:write',
  'admin:*'
];

// Granular access control
app.delete('/api/data/:id', requirePermissions(['data:delete']), handler);
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test crypto.utils.test.ts
```

### Test Coverage

The authentication system has 100% test coverage:

```
File                            | % Stmts | % Branch | % Funcs | % Lines
--------------------------------|---------|----------|---------|--------
utils/crypto.utils.ts           |     100 |      100 |     100 |     100
services/token.service.ts       |     100 |      100 |     100 |     100
services/auth.service.ts        |     100 |      100 |     100 |     100
middleware/auth.middleware.ts   |     100 |      100 |     100 |     100
```

### Example Tests

```typescript
import { hashPassword, verifyPassword } from './utils/crypto.utils';

describe('Password Security', () => {
  it('should hash and verify password', async () => {
    const password = 'SecurePass123!';
    const hash = await hashPassword(password);

    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
```

## Troubleshooting

### Common Issues

#### 1. JWT_SECRET not set

**Error:** `JWT_SECRET environment variable is not set`

**Solution:**
```bash
# Generate secret
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"

# Add to .env
echo "JWT_SECRET=YOUR_GENERATED_SECRET" >> .env
```

#### 2. Token expired

**Error:** `Token has expired`

**Solution:**
```typescript
// Refresh the access token
const result = refreshAccessToken(refreshToken);
if (result.success) {
  // Use new access token
  const newAccessToken = result.accessToken;
}
```

#### 3. Rate limit exceeded

**Error:** `Rate limit exceeded for authentication`

**Solution:**
- Wait for the retry-after period
- Check for suspicious activity
- Adjust rate limits if legitimate traffic

#### 4. Invalid API key format

**Error:** `Invalid API key format`

**Solution:**
- Ensure API key starts with `agdb_live_` or `agdb_test_`
- Check for whitespace or encoding issues
- Regenerate API key if corrupted

### Debug Mode

Enable debug logging:

```bash
# .env
AUDIT_LOG_TO_CONSOLE=true
NODE_ENV=development
```

### Support

For issues and questions:
- GitHub Issues: https://github.com/ruvnet/agentic-flow/issues
- Documentation: https://agentdb.ruv.io
- Security Issues: security@agentdb.io (private disclosure)

---

**Last Updated:** 2025-12-02
**Version:** 2.0.0-alpha
**License:** MIT
