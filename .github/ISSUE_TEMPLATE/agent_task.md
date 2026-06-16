---
name: "🤖 Agent Task / Bug Report"
description: Standardized issue template for AI Agents and automated workflows in this monorepo.
title: "[Agent] "
labels: ["agent-monitored"]
assignees: ""
---

## 1. Metadata (Strictly Required)
- **Target Package/App:** `@apps/` or `@packages/`
- **Sub-system / Layer:** (e.g., backend-api, smart-contracts, infra, worker)
- **Priority:** Low / Medium / High / Critical

---

## 2. Context & Environment
<agent-context>
- **Monorepo Context:** - [ ] Affects multiple packages (Cross-dependency issue)
  - [ ] Isolated to a single package
- **Relevant Dependencies:** (e.g., Go 1.2x, Kafka, Ethers.js, Podman)
- **Related Issues/PRs:** #
</agent-context>

---

## 3. Problem Statement / Task Objective
### Current Behavior
> 

### Expected Behavior
> 

---

## 4. Architectural Rules & Constraints
- [ ] **Modularity:** Ensure logic does not leak across boundary layers.
- [ ] **Clean Architecture:** Keep business logic independent of external frameworks/drivers.
- [ ] **Zero Breaking Changes:** Internal APIs shared across the monorepo must remain backward compatible.

---

## 5. Technical Specifications & References
```logs
// Paste error logs or stack traces here if any
