# DesignFlow Product Context & Business Logic

> **Note to AI/Developers:** This file serves as the "Source of Truth" for the product's business logic, user flows, and domain models. **Read this first** before implementing new features to ensure alignment with the existing architecture.

## 1. Product Vision
**DesignFlow** is an AI-driven Workflow Management System tailored for E-commerce Design teams. It solves the fragmentation between Product Directors (PD), Operations (Ops), and Designers by unifying:
1.  **Task Management:** Kanban-based flow (Backlog -> Done).
2.  **Asset Management:** Centralized SKU assets and reference files.
3.  **Structured Briefs:** Standardized forms for selling points, compliance notes, and style tags.
4.  **Role-Based Access:** Strict permission controls for different stakeholders.

---

## 2. Core Domain Models

### 2.1 The Task (Unit of Work)
A Task represents a design request for a specific Product (SKU). It is **not** just a title and description. It consists of 4 distinct data blocks:
1.  **Identity:** Static product info (SKU, Name, Launch Date, Brand).
2.  **Assets & Logistics:** Raw materials (Sample arrival, 3D files, Silk screen mods).
3.  **Requirements (Content):** Marketing inputs (Selling points, Compliance notes, Style tags).
4.  **Directives (Design):** Art direction (SOPs, AI Prompts, Reference Images).

### 2.2 Task Types (Dynamic Configuration)
Tasks are not one-size-fits-all. We use a **Dynamic Field System**.
- **Config:** Managed in `SettingsModal`.
- **Logic:** Each `TaskType` (e.g., "Amazon Main Image", "Manual") defines which fields are `visible` and `required`.
- **Constraint:** Code must check `type.fields[key].visible` before rendering inputs.

---

## 3. Workflow & Stages (Kanban)

The lifecycle of a task follows a strict linear path defined by `COLUMNS` in `constants.ts`.

| Stage ID | Title | Owner Role | Business Logic |
| :--- | :--- | :--- | :--- |
| `BACKLOG` | Backlog | PD / Ops | Draft stage. Requirements gathering. |
| `AI_OPS` | AI Ops | DD | AI prototyping. generating concepts based on prompts. |
| `REVIEW` | Review | Team | Daily standup review. Decision to proceed or kill. |
| `DOING` | Doing | Designer | Actual design execution (PSD/AI work). |
| `QA` | QA | Ops | Final check against compliance/selling points. |
| `DONE` | Done | System | Archived/Live. |

---

## 4. Roles & Permissions (RBAC)

**System Version:** 2.3 (Dynamic Roles backed by DB)

### 4.1 Role Hierarchy
Roles are stored in the `roles` table. Default system roles:
1.  **Admin:** Superuser. Can do everything.
2.  **PD (Product Director):** Focus on *Creation* and *Strategy*.
3.  **Ops (Operations):** Focus on *Requirements* and *QA*.
4.  **DD (Design Director):** Focus on *AI Ops* and *Workflow Settings*.
5.  **Designer:** Focus on *Execution* (Doing).

### 4.2 Permission Keys
Use these keys in `can(permission)` checks:
- `task.create`: Initialize new briefs.
- `task.edit`: Modify content/assets.
- `task.move`: Change Kanban stages.
- `task.delete`: Remove tasks.
- `task.view_all`: See tasks assigned to others.
- `settings.manage`: Access Role Manager & Task Type Config.
- `users.approve`: Gatekeep new registrations.
- `assets.upload`: Upload files to storage.

---

## 5. Technical Architecture Constraints

### 5.1 Database & Sync
- **Supabase:** Used for Auth, Database (Postgres), and Storage.
- **Self-Healing:** The app must work even if the DB is empty. `db.ts` contains logic to `seedDatabase` and `create_profile_if_missing`.
- **RLS (Row Level Security):** All tables (`tasks`, `profiles`, `roles`) must have RLS policies enabled. Updates are distributed via `SetupWizard.tsx` SQL scripts.

### 5.2 Bilingual Support (i18n)
- **Mandatory:** ALL UI text must be in `i18n.ts`.
- **Structure:** `translations['en']` and `translations['cn']`.
- **No Hardcoding:** Never write static English/Chinese in components.

### 5.3 Offline/Error Resilience
- If Supabase is unreachable, the app should show "Offline" status but not crash.
- `db.checkConnection()` dictates the UI state.

---

## 6. Future Roadmap (Context for AI)
1.  **AI Integration:** Real integration with Midjourney/Stable Diffusion APIs in the `AI_OPS` stage.
2.  **Export:** Generate PDF Design Briefs from Task data.
3.  **Notifications:** Real-time email/in-app alerts for Stage moves.
4.  **Version Control:** History tracking for specific field changes.
