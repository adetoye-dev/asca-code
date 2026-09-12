---
name: refactor
description: Clean architecture refactoring preserving interfaces and eliminating regressions
triggers: [/refactor, refactor, clean up, extract component, decouple]
tools: [search_symbols, get_file_outline, get_blast_radius, read_code_slice]
---

# Clean Architecture Refactoring Skill

Use this skill to refactor complex, duplicated, or monolithic functions into clean, decoupled components.

## Invariants
1. **Preserve External Interface**: Do not alter function signatures that are consumed by external callers.
2. **Blast Radius Check**: Before refactoring, check dependent files using `get_blast_radius`.
3. **Single Responsibility**: Each function or module must have a single clear purpose.
4. **Zero Semantic Regressions**: All existing behavior must remain identical.
