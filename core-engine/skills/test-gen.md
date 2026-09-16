---
name: test-gen
description: Adversarial and property-based test generation for unit and edge-case validation
triggers: [/test-gen, test-gen, generate tests, unit test, write tests, test coverage]
tools: [search_symbols, get_file_outline, read_code_slice]
---

# Adversarial & Property-Based Test Generation Skill

Use this skill to generate exhaustive unit and edge-case test suites for functions.

## Process
1. **Extract Type Signatures**: Inspect parameter types and return contracts from the symbol index.
2. **Identify Invariants**: Determine what must ALWAYS be true (e.g. non-negative results, idempotency).
3. **Adversarial Edge Cases**:
   - Empty strings, whitespace-only strings.
   - Extremely large numbers, negative values, zero, float boundaries.
   - None / null / undefined inputs.
   - Malformed payloads and Unicode edge cases.
4. **Executable Test Output**: Emit test cases formatted for `pytest` or `vitest`/`jest`.
