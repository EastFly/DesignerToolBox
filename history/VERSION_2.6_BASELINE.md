
# DesignFlow System Baseline - Version 2.6

**Date:** 2024-05-22
**Version:** 2.6 (Rollback, Permissions & Stability Fixes)
**Status:** Stable Baseline

## 1. System Overview
DesignFlow is an AI-driven, Role-Based Access Control (RBAC) workflow management system designed for Cross-Border E-commerce scenarios. It features a dynamic Kanban board where Task Types, Stages, and Fields are fully configurable via a "Matrix" system.

### Tech Stack
*   **Frontend:** React 19, TypeScript, Tailwind CSS
*   **Backend / DB:** Supabase (PostgreSQL, Auth, Storage, Realtime)
*   **AI Integration:** Google Gemini SDK (`@google/genai`)
*   **Icons:** Lucide React
*   **Utils:** date-fns

---

## 2. Core Functional Modules

### A. Dynamic Configuration Engine (The "Brain")
The system does not hardcode forms. Instead, it uses a Matrix configuration:
*   **Global Fields:** Defined in Settings. Supports types: Text, RichText, Select, Date, **Folder**, Image, Video.
*   **Global Stages:** Defined in Settings (e.g., Backlog, AI Ops, QA).
*   **Task Types (Workflows):** Connects Fields to Stages.
    *   *Configuration:* For each Task Type + Stage combination, every field has a state: `Visible`, `Required`, `Read-Only`, `AI Enabled`.

### B. Task Management (The "Body")
*   **Kanban Board:** Columns are rendered based on the Global Stages configuration.
*   **Task Card:** Displays Priority (P0-P2), SLA Status (Traffic light system), and Thumbnail hierarchy (Product Image > Final Design > AI > Asset).
*   **Workspace Modal:** The main interaction point.
    *   **Tabs:** Generated dynamically based on the Task Type's workflow.
    *   **Inputs:** Rendered recursively (to support Folders).
    *   **Actions:** Save, Move to Next Stage, **Rollback (Previous Stage)**, Delete.

### C. Role-Based Access Control (RBAC)
Permissions are granular and attached to Roles defined in the database.
*   **Key Permissions:**
    *   `task.view_all`: If missing, user **only** sees tasks where `owner.id === current_user.id`. This is enforced in `App.tsx` filtering and `Header.tsx` Assignee dropdown.
    *   `task.create`, `task.edit`, `task.move`, `task.delete`.
    *   `settings.manage`: Access to the Settings Modal.
*   **User Management:** Admins/Ops can approve new signups (Status: Pending -> Approved).

---

## 3. Key Business Logic & Decisions

### 3.1. Folder Validation Logic (Fixed in v2.6)
*   **Problem:** Previous validation required *all* sub-fields in a folder to be filled, or failed to detect file uploads within folders.
*   **Current Logic:** A `Folder` field is considered **Valid** if **ANY** of its sub-fields have content (Text is not empty OR File array length > 0).
*   **Implementation:** `NewTaskModal.tsx` -> `isFormValid` uses `some()` check on sub-fields.

### 3.2. File Upload Persistence (Fixed in v2.6)
*   **Problem:** Uploading a file but closing the modal without clicking "Save" caused data loss because file uploads are asynchronous actions separate from the main form state.
*   **Current Logic:** File uploads (Images/Videos) trigger an **Immediate Database Update** (`db.updateTask`) upon successful upload.
*   **Implementation:** `WorkspaceModal.tsx` -> `handleUpdateField(..., shouldPersist=true)`.

### 3.3. Task Rollback
*   **Logic:** System calculates the `prevStage` based on the current Task Type's `workflow` array index.
*   **Action:** Resets status to `not_started` (implied context) or keeps as is, moving the card back one column.

### 3.4. System Reset
*   **Feature:** Admin-only button in Settings -> System.
*   **Action:** Wipes `tasks`, `task_types`, `roles` (except defaults), and `fields`. Reseeds database with `constants.ts` initial data.

### 3.5. AI Configuration
*   **Location:** Settings -> Fields -> "Magic Wand" or Settings -> Types -> "Magic Wand".
*   **Function:** Allows defining "Context Description" (Global) and "Prompt Templates" (Per Stage).
*   **Integration:** Uses Gemini to "Refine" these prompts for the administrator.

---

## 4. Database Schema (Supabase)

### Tables
1.  **`public.tasks`**: Stores task data. `content` column is a JSONB blob containing all dynamic fields.
2.  **`public.task_types`**: Stores configuration. `fields` column contains the Workflow array and Field Matrix.
3.  **`public.profiles`**: Extends Auth users. Stores `role`, `status`, `avatar_url`.
4.  **`public.roles`**: Stores Role definitions and Permission arrays.

### Security (RLS)
*   **Policies:** Enabled on all tables.
*   **Trigger:** `handle_new_user` Postgres trigger automatically creates a `profile` entry when a user signs up via Supabase Auth.
*   **Fallback:** `create_profile_if_missing` RPC function exists to self-heal if the trigger fails.

---

## 5. Known Dependencies & File Structure

### Key Files
*   `App.tsx`: Main controller, data loading, permission filtering.
*   `types.ts`: TypeScript definitions for the dynamic field system.
*   `components/WorkspaceModal.tsx`: Complex logic for rendering fields and handling state updates.
*   `components/SettingsModal.tsx`: The configuration UI for the Matrix.
*   `services/db.ts`: Abstraction layer for Supabase interactions.

### External Libraries
*   `lucide-react`: UI Icons.
*   `date-fns`: Date formatting and math.
*   `@google/genai`: AI interactions.
*   `@supabase/supabase-js`: Backend communication.

---

**End of Baseline v2.6**
