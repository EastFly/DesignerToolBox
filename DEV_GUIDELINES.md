# DesignFlow Development Guidelines

## 0. **CRITICAL: Business Context**
**Before writing code, ALWAYS refer to `PRODUCT_CONTEXT.md`.**
That file contains the definition of "What we are building" and "Why".
If you add a new business feature (e.g., a new Workflow Stage), you **MUST** update `PRODUCT_CONTEXT.md`.

## 1. Architecture Overview
- **Frontend**: React + TypeScript + Tailwind CSS.
- **Backend**: Supabase (PostgreSQL + RLS + Auth).
- **State Management**: React Hooks (Keep it simple, lift state up to `App.tsx` when necessary).

## 2. Authentication & Roles (RBAC)
The system uses a flexible Role-Based Access Control (RBAC) system.

### Data Structure
- **Users**: Managed by Supabase Auth (`auth.users`).
- **Profiles**: `public.profiles` extends user info, containing a `role` string field.
- **Roles**: `public.roles` table defines the configuration for each role ID (e.g., 'PD', 'Designer') and its `permissions` (JSON array).

### Permissions List (Updated: V2.3)
When adding new features, **ALWAYS** check if a new permission is needed or if it fits an existing one.

| Permission Key | Description |
| :--- | :--- |
| `task.create` | Can create new tasks. |
| `task.edit` | Can edit task details (Basic Info, Requirements). |
| `task.delete` | Can delete tasks. |
| `task.move` | Can drag/drop tasks between stages. |
| `task.view_all` | Can see tasks assigned to others (if false, only sees own tasks). |
| `settings.manage` | Can access workflow settings and role management. |
| `users.approve` | Can approve new user registrations. |
| `assets.upload` | Can upload files. |

## 3. Checklist for New Features
Before writing code for a new feature (e.g., "Export Report"), follow these steps:

1.  [ ] **Check Context**: Read `PRODUCT_CONTEXT.md` to understand where this feature fits.
2.  [ ] **Define Permission**: Does this require a restricted permission? (e.g., `report.export`).
3.  [ ] **Update Constants**: Add the permission key to `AVAILABLE_PERMISSIONS` in `constants.ts`.
4.  [ ] **Database Migration**: If adding a new default role, update the SQL in `SetupWizard.tsx`.
5.  [ ] **UI Guard**: Wrap the UI element (Button/Link) with a permission check:
    ```typescript
    // Example
    if (checkPermission(userRole, 'report.export')) {
      return <ExportButton />;
    }
    ```
6.  [ ] **Translations**: Update `i18n.ts` for any new permission labels.
7.  [ ] **Update Docs**: Update `PRODUCT_CONTEXT.md` if the business logic changes.

## 4. Database Schema Rules
- All tables must have Row Level Security (RLS) enabled.
- Use the `SetupWizard.tsx` to distribute SQL updates to clients.
