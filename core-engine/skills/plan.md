---
name: plan
description: Architecture and implementation planning before modifying code
triggers: [/plan, plan, architect, design, proposal, blueprint]
tools: [search_symbols, get_file_outline, get_blast_radius]
---

# Architecture & Implementation Planning Skill

Use this skill when asked to plan, architect, or design a technical implementation before modifying code.

## Guiding Principles
1. **Analyze Existing Conventions**: Check the symbol graph and existing files before proposing new patterns.
2. **Standardize Without Over-Engineering**: Aim for the industry standard appropriate for the project's scale.
3. **No Breaking Changes**: Preserve public interfaces and function signatures unless explicitly requested.

## Standard Output Structure
1. **Requirements Analysis**: Core problem statement and boundary conditions.
2. **Architecture & Trade-offs**: Chosen patterns and why alternative approaches were rejected.
3. **Affected Files & Blast Radius**: List of modified files and downstream dependents.
4. **Step-by-Step Implementation Steps**: Atomic, ordered steps.
5. **Verification & Testing Strategy**: How to verify syntax, correctness, and performance.
