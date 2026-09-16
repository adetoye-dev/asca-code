---
name: review
description: Code review, security auditing, and performance analysis
triggers: [/review, review, audit, security check, pr review, inspect code]
tools: [search_symbols, get_file_outline, read_code_slice]
---

# Code Review & Security Audit Skill

Use this skill to evaluate code changes, review pull requests, or audit security and performance.

## Review Dimensions
1. **Correctness & Edge Cases**: Are null/undefined values handled? Are boundary conditions tested?
2. **Security Safeguards**: Check for injection risks, unvalidated input, insecure secrets handling.
3. **Performance & Memory**: Check for unintended O(N²) iterations, unbounded memory caches, memory leaks.
4. **Maintainability**: Ensure clear naming, strict type annotations, and adherence to codebase style.
