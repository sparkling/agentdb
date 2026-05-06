# Security Guidelines for AgentDB Development

**Last Updated**: 2025-12-02
**Version**: 2.0.0-alpha

This document provides security guidelines for developers working on AgentDB to maintain the highest security standards and prevent common vulnerabilities.

---

## Table of Contents

1. [SQL Injection Prevention](#sql-injection-prevention)
2. [Input Validation](#input-validation)
3. [Error Handling](#error-handling)
4. [Database Operations](#database-operations)
5. [Testing Requirements](#testing-requirements)
6. [Code Review Checklist](#code-review-checklist)

---

## SQL Injection Prevention

### ✅ Always Use Parameterized Queries

**REQUIRED**: All database queries MUST use parameterized statements with `?` placeholders.

```typescript
// ✅ CORRECT: Parameterized query
const stmt = db.prepare('SELECT * FROM episodes WHERE session_id = ? AND reward > ?');
const results = stmt.all(sessionId, minReward);

// ❌ WRONG: String concatenation
const stmt = db.prepare(`SELECT * FROM episodes WHERE session_id = '${sessionId}'`);

// ❌ WRONG: Template literals with user input
const stmt = db.prepare(`SELECT * FROM episodes WHERE session_id = '${userInput}'`);
```

### ✅ Validate Identifiers Before Interpolation

**RULE**: Table names, column names, and SQL keywords MUST be validated against whitelists BEFORE being used in template literals.

```typescript
// ✅ CORRECT: Validate before interpolation
import { validateTableName, validateColumnName } from '../security/input-validation.js';

const validatedTable = validateTableName(tableName); // Throws ValidationError if invalid
const validatedColumn = validateColumnName(validatedTable, columnName);
const stmt = db.prepare(`SELECT ${validatedColumn} FROM ${validatedTable} WHERE id = ?`);
const result = stmt.get(id);

// ❌ WRONG: Direct interpolation without validation
const stmt = db.prepare(`SELECT ${columnName} FROM ${tableName} WHERE id = ?`);
```

### ✅ Use Safe Query Builders

**RECOMMENDED**: Use provided query builder functions for dynamic queries.

```typescript
import { buildSafeWhereClause, buildSafeSetClause } from '../security/input-validation.js';

// ✅ CORRECT: Safe WHERE clause builder
const { clause, values } = buildSafeWhereClause('episodes', {
  session_id: sessionId,
  reward: minReward
});
const stmt = db.prepare(`SELECT * FROM episodes WHERE ${clause}`);
const results = stmt.all(...values);

// ✅ CORRECT: Safe SET clause builder
const setResult = buildSafeSetClause('episodes', {
  reward: newReward,
  success: true
});
const whereResult = buildSafeWhereClause('episodes', { id: episodeId });
const stmt = db.prepare(
  `UPDATE episodes SET ${setResult.clause} WHERE ${whereResult.clause}`
);
stmt.run(...setResult.values, ...whereResult.values);
```

### ✅ IN Clause with Placeholders

**RULE**: When using IN clauses, generate placeholders programmatically.

```typescript
// ✅ CORRECT: Safe IN clause
const placeholders = ids.map(() => '?').join(',');
const stmt = db.prepare(`SELECT * FROM episodes WHERE id IN (${placeholders})`);
const results = stmt.all(...ids);

// ❌ WRONG: Concatenating IDs
const stmt = db.prepare(`SELECT * FROM episodes WHERE id IN (${ids.join(',')})`);
```

---

## Input Validation

### ✅ Validate All User Input

**REQUIRED**: All user input MUST be validated before use.

```typescript
import {
  validateSessionId,
  validateId,
  validateReward,
  validateSuccess,
  sanitizeText,
  validateTags,
  validateTaskString,
  validateNumericRange,
  validateArrayLength,
  validateObject,
  validateBoolean,
  validateEnum
} from '../security/input-validation.js';

// ✅ CORRECT: Validate session ID
const sessionId = validateSessionId(userInput.sessionId);

// ✅ CORRECT: Validate numeric ID
const episodeId = validateId(userInput.id, 'episodeId');

// ✅ CORRECT: Validate reward (0-1 range)
const reward = validateReward(userInput.reward);

// ✅ CORRECT: Validate boolean
const success = validateSuccess(userInput.success);

// ✅ CORRECT: Sanitize text input
const task = sanitizeText(userInput.task, 10000, 'task');

// ✅ CORRECT: Validate tags array
const tags = validateTags(userInput.tags);

// ✅ CORRECT: Validate task string (with XSS checks)
const taskString = validateTaskString(userInput.task);

// ✅ CORRECT: Validate numeric range
const k = validateNumericRange(userInput.k, 'k', 1, 100);

// ✅ CORRECT: Validate array length
const items = validateArrayLength(userInput.items, 'items', 1, 1000);

// ✅ CORRECT: Validate object
const metadata = validateObject(userInput.metadata, 'metadata', false);

// ✅ CORRECT: Validate boolean with default
const verbose = validateBoolean(userInput.verbose, 'verbose', false);

// ✅ CORRECT: Validate enum
const type = validateEnum(userInput.type, 'type', ['episode', 'skill', 'pattern'] as const);
```

### ✅ Whitelists for Identifiers

**REQUIRED**: Maintain whitelists in `src/security/input-validation.ts` for:

1. **Table names**: `ALLOWED_TABLES`
2. **Column names**: `ALLOWED_COLUMNS` (per table)
3. **PRAGMA commands**: `ALLOWED_PRAGMAS`

```typescript
// When adding new tables or columns, update the whitelists:

// src/security/input-validation.ts
const ALLOWED_TABLES = new Set([
  'episodes',
  'skills',
  // ... add your new table here
  'my_new_table',
]);

const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  episodes: new Set([
    'id', 'session_id', 'task', 'reward',
    // ... existing columns
  ]),
  my_new_table: new Set([
    'id', 'name', 'description',
    // ... add allowed columns for new table
  ]),
};
```

### ✅ Validation Error Handling

**RULE**: Always catch and handle `ValidationError` appropriately.

```typescript
import { ValidationError } from '../security/input-validation.js';

try {
  const validatedTable = validateTableName(tableName);
  // ... use validatedTable
} catch (error) {
  if (error instanceof ValidationError) {
    // Safe error message for user
    console.error(`Validation error: ${error.message}`);
    return { error: error.getSafeMessage() };
  }
  // Handle other errors
  throw error;
}
```

---

## Error Handling

### ✅ Safe Error Messages

**RULE**: Never leak sensitive information in error messages.

```typescript
// ✅ CORRECT: Generic error message
try {
  const result = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id);
  if (!result) {
    throw new Error('Resource not found');
  }
} catch (error) {
  // Don't expose database details
  return { error: 'An error occurred while processing your request' };
}

// ❌ WRONG: Exposes internal details
catch (error) {
  return { error: `Database error: ${error.message}` };
}
```

### ✅ ValidationError Usage

**RECOMMENDED**: Use `ValidationError` for all validation failures.

```typescript
import { ValidationError } from '../security/input-validation.js';

function validateCustomInput(input: unknown): string {
  if (typeof input !== 'string') {
    throw new ValidationError(
      'Input must be a string',
      'INVALID_TYPE',
      'customInput'
    );
  }

  if (input.length > 1000) {
    throw new ValidationError(
      'Input exceeds maximum length',
      'INPUT_TOO_LONG',
      'customInput'
    );
  }

  return input;
}
```

### ✅ Error Code Standards

**STANDARD**: Use consistent error codes:

- `VALIDATION_ERROR` - General validation failure
- `INVALID_TYPE` - Wrong data type
- `INVALID_TABLE` - Invalid table name
- `INVALID_COLUMN` - Invalid column name
- `INVALID_PRAGMA` - Invalid PRAGMA command
- `MISSING_REQUIRED_FIELD` - Required field missing
- `OUT_OF_RANGE` - Numeric value out of bounds
- `STRING_TOO_LONG` - String exceeds max length
- `SUSPICIOUS_CONTENT` - Potentially malicious input detected

---

## Database Operations

### ✅ Use Transactions for Multi-Step Operations

**REQUIRED**: Wrap multiple related operations in transactions.

```typescript
// ✅ CORRECT: Transaction for bulk insert
const transaction = db.transaction((episodes: Episode[]) => {
  const stmt = db.prepare(`
    INSERT INTO episodes (session_id, task, reward, success)
    VALUES (?, ?, ?, ?)
  `);

  for (const episode of episodes) {
    stmt.run(episode.sessionId, episode.task, episode.reward, episode.success);
  }
});

transaction(episodesArray);

// ❌ WRONG: Individual inserts without transaction
for (const episode of episodesArray) {
  db.prepare(`INSERT INTO episodes (...) VALUES (?, ?, ?, ?)`).run(...);
}
```

### ✅ Prepared Statement Reuse

**OPTIMIZATION**: Reuse prepared statements for better performance.

```typescript
// ✅ CORRECT: Prepare statement outside loop
const stmt = db.prepare('INSERT INTO episodes (...) VALUES (?, ?, ?, ?)');

const transaction = db.transaction(() => {
  for (const episode of episodes) {
    stmt.run(episode.sessionId, episode.task, episode.reward, episode.success);
  }
});

transaction();

// ❌ WRONG: Prepare inside loop
for (const episode of episodes) {
  const stmt = db.prepare('INSERT INTO episodes (...) VALUES (?, ?, ?, ?)');
  stmt.run(...);
}
```

### ✅ Foreign Key Constraints

**RULE**: Always enable foreign key constraints.

```typescript
// ✅ CORRECT: Enable foreign keys
db.pragma('foreign_keys = ON');

// Schema with foreign key constraints
db.exec(`
  CREATE TABLE episode_embeddings (
    episode_id INTEGER PRIMARY KEY,
    embedding BLOB NOT NULL,
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
  );
`);
```

---

## Testing Requirements

### ✅ Security Test Coverage

**REQUIRED**: All database operations MUST have corresponding security tests.

```typescript
// tests/security/my-feature.test.ts
import { describe, it, expect } from 'vitest';
import { ValidationError } from '../../src/security/input-validation.js';

describe('MyFeature Security', () => {
  it('should reject SQL injection in table name', () => {
    expect(() => {
      myFeature.query('episodes; DROP TABLE--', { id: 1 });
    }).toThrow(ValidationError);
  });

  it('should reject SQL injection in column name', () => {
    expect(() => {
      myFeature.query('episodes', { 'id; DROP--': 1 });
    }).toThrow(ValidationError);
  });

  it('should safely handle special characters in values', () => {
    const result = myFeature.query('episodes', {
      session_id: "'; DROP TABLE--"
    });
    // Should execute safely without SQL injection
    expect(result).toBeDefined();
  });

  it('should not leak sensitive info in errors', () => {
    try {
      myFeature.query('invalid_table', {});
    } catch (error) {
      expect(error.message).not.toContain('sqlite');
      expect(error.message).not.toContain('/var/');
    }
  });
});
```

### ✅ Test Attack Vectors

**REQUIRED**: Test common SQL injection patterns:

```typescript
const sqlInjectionPatterns = [
  "'; DROP TABLE episodes--",
  "' OR '1'='1--",
  "' UNION SELECT * FROM sqlite_master--",
  "'; DELETE FROM episodes WHERE '1'='1--",
  "\x00malicious",
  "test\nDROP TABLE",
];

for (const pattern of sqlInjectionPatterns) {
  it(`should reject injection pattern: ${pattern}`, () => {
    expect(() => {
      myFeature.query('episodes', { session_id: pattern });
    }).not.toThrow(); // Should execute safely, not throw
  });
}
```

---

## Code Review Checklist

### Security Review Checklist

Use this checklist when reviewing database-related code:

#### SQL Queries

- [ ] All queries use parameterized statements (`?` placeholders)
- [ ] No string concatenation with user input
- [ ] No template literals with unvalidated identifiers
- [ ] Table names validated against whitelist before interpolation
- [ ] Column names validated against whitelist before interpolation
- [ ] IN clauses use generated placeholders

#### Input Validation

- [ ] All user input validated before use
- [ ] Appropriate validation functions used (validateId, validateSessionId, etc.)
- [ ] Custom validation includes length limits
- [ ] Custom validation includes type checking
- [ ] Tags and arrays validated for length and content
- [ ] Text inputs sanitized (null bytes removed, length checked)

#### Error Handling

- [ ] ValidationError used for validation failures
- [ ] Error messages don't leak sensitive information
- [ ] Error codes are consistent and documented
- [ ] Database errors are caught and sanitized
- [ ] getSafeMessage() used for user-facing errors

#### Database Operations

- [ ] Multi-step operations use transactions
- [ ] Prepared statements reused when possible
- [ ] Foreign key constraints enabled
- [ ] Indexes created for performance
- [ ] CASCADE DELETE configured appropriately

#### Testing

- [ ] Security tests cover SQL injection attempts
- [ ] Tests verify validation error handling
- [ ] Tests check error message safety
- [ ] Tests include edge cases (empty strings, null bytes, unicode)
- [ ] Tests verify transaction rollback on errors

#### Documentation

- [ ] New tables added to ALLOWED_TABLES whitelist
- [ ] New columns added to ALLOWED_COLUMNS whitelist
- [ ] API documentation mentions validation requirements
- [ ] Security implications noted in comments

---

## Examples

### Complete Secure Function Example

```typescript
import {
  validateSessionId,
  validateNumericRange,
  validateBoolean,
  ValidationError
} from '../security/input-validation.js';

/**
 * Search episodes with security validation
 *
 * @param sessionId - Session ID (validated)
 * @param k - Number of results (1-100)
 * @param onlySuccessful - Filter by success flag
 * @returns Array of episodes
 * @throws ValidationError on invalid input
 */
export function searchEpisodes(
  sessionId: string,
  k: number = 10,
  onlySuccessful: boolean = false
): Episode[] {
  try {
    // Validate all inputs
    const validatedSessionId = validateSessionId(sessionId);
    const validatedK = validateNumericRange(k, 'k', 1, 100);
    const validatedSuccess = validateBoolean(onlySuccessful, 'onlySuccessful', false);

    // Build query with parameterized values
    let query = 'SELECT * FROM episodes WHERE session_id = ?';
    const params: any[] = [validatedSessionId];

    if (validatedSuccess) {
      query += ' AND success = ?';
      params.push(1);
    }

    query += ' LIMIT ?';
    params.push(validatedK);

    // Execute with prepared statement
    const stmt = db.prepare(query);
    const results = stmt.all(...params);

    return results.map(row => hydrateEpisode(row));
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(`Validation error in searchEpisodes: ${error.message}`);
      throw error; // Re-throw for caller to handle
    }
    // Log unexpected errors internally
    console.error('Unexpected error in searchEpisodes:', error);
    throw new Error('An error occurred while searching episodes');
  }
}
```

---

## Security Resources

### Internal Documentation

- [Security Audit Report](./SECURITY_AUDIT_REPORT.md)
- [Input Validation API](../src/security/input-validation.ts)
- [Security Tests](../tests/security/)

### External Resources

- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [CWE-89: SQL Injection](https://cwe.mitre.org/data/definitions/89.html)
- [better-sqlite3 Security](https://github.com/WiseLibs/better-sqlite3/wiki/Security)

---

## Contact

For security concerns or questions:

- **Security Issues**: Report via GitHub Security Advisories
- **Questions**: Open a GitHub Discussion
- **Critical Vulnerabilities**: Email security@example.com (if available)

---

**Last Updated**: 2025-12-02
**Maintained By**: AgentDB Security Team
