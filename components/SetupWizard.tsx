
import React, { useState } from 'react';
import { Database, Copy, ExternalLink, CheckCircle, AlertTriangle, RefreshCw, X, MailWarning } from 'lucide-react';
import { translations, Language } from '../i18n';

interface SetupWizardProps {
  language: Language;
  onRetry: () => void;
  onClose?: () => void;
  errorType?: 'MISSING_TABLES' | 'RLS_ERROR';
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ language, onRetry, onClose, errorType }) => {
  const t = translations[language];
  const [isChecking, setIsChecking] = useState(false);
  
  const handleRetry = async () => {
      setIsChecking(true);
      await new Promise(r => setTimeout(r, 800));
      await onRetry();
      setIsChecking(false);
  };
  
  const setupSQL = `
-- 1. Create Tables (IF NOT EXISTS only creates tables if they don't exist)
create table if not exists public.tasks (
  id text primary key,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  stage text,
  content jsonb,
  time_logs jsonb default '[]'::jsonb,
  lifecycle_status text default 'active'
);

create table if not exists public.task_types (
  id text primary key,
  name text,
  fields jsonb
);

create table if not exists public.roles (
  id text primary key,
  name text,
  permissions jsonb,
  is_system boolean default false
);

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  full_name text,
  role text,
  avatar_url text,
  status text default 'pending',
  created_at timestamptz default now()
);

-- NEW: Prompt Flows Table (v2.8)
create table if not exists public.prompt_flows (
  id text primary key,
  name text,
  description text,
  nodes jsonb default '[]'::jsonb,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  edges jsonb default '[]'::jsonb
);

-- NEW: Products Table (v2.9 - Product Management)
create table if not exists public.products (
  id text primary key,
  sku text,
  name text,
  data jsonb default '{}'::jsonb, -- Stores dynamic field data
  history jsonb default '[]'::jsonb, -- Stores version history/audit log
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- Explicit columns for basic info (v2.9.1)
  level text,
  brands text[] default '{}',
  channels text[] default '{}',
  specs jsonb default '[]'::jsonb,
  competitors jsonb default '[]'::jsonb
);

-- NEW: Style Dice (Playground) Table (v2.12)
create table if not exists public.style_dice (
  id text primary key,
  user_id uuid references auth.users on delete cascade,
  name text,
  description text,
  template text,
  cover_image text,
  is_global boolean default false,
  created_at timestamptz default now()
);

-- NEW: Midnight Missions (v2.13 - Agent Queue)
create table if not exists public.midnight_missions (
  id text primary key,
  user_id uuid references auth.users on delete cascade,
  status text default 'pending', -- pending, processing, completed, failed
  product_name text,
  payload jsonb default '{}'::jsonb,
  result jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- NEW: Model Usage (v2.14 - Usage Tracking)
create table if not exists public.model_usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  module text,
  model_name text,
  parameters jsonb,
  created_at timestamptz default now()
);

-- 1.1 MIGRATIONS (Fix for Existing Tables missing new columns)
-- Ensure 'time_logs' exists on 'tasks'
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'time_logs') then
    alter table public.tasks add column time_logs jsonb default '[]'::jsonb;
  end if;
  -- v2.9: Ensure 'edges' exists on 'prompt_flows'
  if not exists (select 1 from information_schema.columns where table_name = 'prompt_flows' and column_name = 'edges') then
    alter table public.prompt_flows add column edges jsonb default '[]'::jsonb;
  end if;
  -- v2.11: Ensure 'lifecycle_status' exists on 'tasks'
  if not exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'lifecycle_status') then
    alter table public.tasks add column lifecycle_status text default 'active';
    -- Backfill based on content
    update public.tasks set lifecycle_status = 'deleted' where content->>'deletedAt' is not null;
    update public.tasks set lifecycle_status = 'archived' where content->>'archivedAt' is not null and content->>'deletedAt' is null;
  end if;
  -- v2.12: Ensure 'user_id' exists on 'style_dice'
  if not exists (select 1 from information_schema.columns where table_name = 'style_dice' and column_name = 'user_id') then
    alter table public.style_dice add column user_id uuid references auth.users on delete cascade;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'style_dice' and column_name = 'is_global') then
    alter table public.style_dice add column is_global boolean default false;
  end if;
  
  -- v2.13: Ensure 'level', 'brands', 'channels' exist on 'products'
  if not exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'level') then
    alter table public.products add column level text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'brands') then
    alter table public.products add column brands text[] default '{}';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'channels') then
    alter table public.products add column channels text[] default '{}';
  end if;
  -- v2.14: Ensure 'specs', 'competitors' exist on 'products'
  if not exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'specs') then
    alter table public.products add column specs jsonb default '[]'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'competitors') then
    alter table public.products add column competitors jsonb default '[]'::jsonb;
  end if;
end $$;

-- 2. RESET PERMISSIONS (RLS)
alter table public.tasks enable row level security;
alter table public.task_types enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.prompt_flows enable row level security;
alter table public.products enable row level security;
alter table public.style_dice enable row level security;
alter table public.midnight_missions enable row level security;
alter table public.model_usage enable row level security;

-- Clear old policies
drop policy if exists "Enable all access" on public.tasks;
drop policy if exists "Enable all access" on public.task_types;
drop policy if exists "Enable all access" on public.prompt_flows;
drop policy if exists "Enable all access" on public.products;
drop policy if exists "Enable all access" on public.style_dice;
drop policy if exists "Users see their own dice" on public.style_dice;
drop policy if exists "Users insert their own dice" on public.style_dice;
drop policy if exists "Users update their own dice" on public.style_dice;
drop policy if exists "Users delete their own dice" on public.style_dice;
drop policy if exists "Enable all access" on public.midnight_missions;
drop policy if exists "Enable all access" on public.model_usage;
drop policy if exists "Public profiles" on public.profiles;
drop policy if exists "Self update" on public.profiles;
drop policy if exists "Self insert" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;
drop policy if exists "Managers can update profiles" on public.profiles;
drop policy if exists "Enable all access" on public.roles;

-- Create permissive policies
create policy "Enable all access" on public.tasks for all to anon, authenticated, service_role using (true) with check (true);
create policy "Enable all access" on public.task_types for all to anon, authenticated, service_role using (true) with check (true);
create policy "Enable all access" on public.roles for all to anon, authenticated, service_role using (true) with check (true);
create policy "Enable all access" on public.prompt_flows for all to anon, authenticated, service_role using (true) with check (true);
create policy "Enable all access" on public.products for all to anon, authenticated, service_role using (true) with check (true);
create policy "Enable all access" on public.midnight_missions for all to anon, authenticated, service_role using (true) with check (true);
create policy "Enable all access" on public.model_usage for all to anon, authenticated, service_role using (true) with check (true);

-- Style Dice: Private Policy
create policy "Users see their own dice" on public.style_dice for select using (auth.uid() = user_id);
create policy "Users insert their own dice" on public.style_dice for insert with check (auth.uid() = user_id);
create policy "Users update their own dice" on public.style_dice for update using (auth.uid() = user_id);
create policy "Users delete their own dice" on public.style_dice for delete using (auth.uid() = user_id);

create policy "Public profiles" on public.profiles for select to anon, authenticated, service_role using (true);
create policy "Self update" on public.profiles for update using (auth.uid() = id);

create policy "Managers can update profiles" on public.profiles for update using (
  exists (
    select 1 from public.profiles p
    left join public.roles r on p.role = r.id
    where p.id = auth.uid() 
    and (
        p.role = 'Admin' 
        or 
        r.permissions @> '["users.approve"]'::jsonb
    )
  )
);

create policy "Self insert" on public.profiles for insert with check (auth.uid() = id);

-- Grant privileges explicitly
grant all on table public.tasks to anon, authenticated, service_role;
grant all on table public.task_types to anon, authenticated, service_role;
grant all on table public.profiles to anon, authenticated, service_role;
grant all on table public.roles to anon, authenticated, service_role;
grant all on table public.prompt_flows to anon, authenticated, service_role;
grant all on table public.products to anon, authenticated, service_role;
grant all on table public.style_dice to anon, authenticated, service_role;
grant all on table public.midnight_missions to anon, authenticated, service_role;
grant all on table public.model_usage to anon, authenticated, service_role;

-- 3. Storage
insert into storage.buckets (id, name, public) values ('designflow-assets', 'designflow-assets', true) on conflict (id) do nothing;
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Public Upload" on storage.objects;
create policy "Public Access" on storage.objects for select using ( bucket_id = 'designflow-assets' ); 
create policy "Public Upload" on storage.objects for insert with check ( bucket_id = 'designflow-assets' );

-- 4. User Trigger
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role, avatar_url, status)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'role', 'https://i.pravatar.cc/150?u=' || new.id, 'pending');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- 5. Safety RPC
create or replace function public.create_profile_if_missing() returns void language plpgsql security definer as $$
declare _user_id uuid; _email text; _meta jsonb;
begin
  _user_id := auth.uid();
  if _user_id is null then return; end if;
  if exists (select 1 from public.profiles where id = _user_id) then return; end if;
  select email, raw_user_meta_data into _email, _meta from auth.users where id = _user_id;
  insert into public.profiles (id, email, full_name, role, avatar_url, status)
  values (_user_id, _email, coalesce(_meta->>'full_name', 'User'), coalesce(_meta->>'role', 'Designer'), 'https://i.pravatar.cc/150?u=' || _user_id, 'pending');
end;
$$;
grant execute on function public.create_profile_if_missing to authenticated;

-- 6. Model Stats RPC
create or replace function public.get_model_usage_stats(days int default 30)
returns json as $$
declare
  result json;
  cutoff timestamptz;
begin
  if days = 0 then
    cutoff := '1970-01-01'::timestamptz;
  else
    cutoff := now() - (days || ' days')::interval;
  end if;

  select json_build_object(
    'total_requests', (select count(*) from public.model_usage where created_at >= cutoff),
    'trend', (
      select coalesce(json_agg(t), '[]'::json) from (
        select to_char(created_at, 'Mon DD') as date, count(*) as count
        from public.model_usage
        where created_at >= cutoff
        group by to_char(created_at, 'Mon DD'), date_trunc('day', created_at)
        order by date_trunc('day', created_at)
      ) t
    ),
    'modules', (
      select coalesce(json_agg(m), '[]'::json) from (
        select module as name, count(*) as value
        from public.model_usage
        where created_at >= cutoff
        group by module
        order by value desc
      ) m
    ),
    'users', (
      select coalesce(json_agg(u), '[]'::json) from (
        select 
          mu.user_id,
          coalesce(p.full_name, p.email, 'Unknown User') as name,
          sum(mu.module_count) as total_count,
          json_object_agg(coalesce(mu.module, 'Unknown'), mu.module_count) as modules
        from (
          select user_id, module, count(*) as module_count
          from public.model_usage
          where created_at >= cutoff
          group by user_id, module
        ) mu
        left join public.profiles p on p.id = mu.user_id
        group by mu.user_id, p.full_name, p.email
        order by total_count desc
      ) u
    ),
    'recent', (
      select coalesce(json_agg(r), '[]'::json) from (
        select 
          mu.created_at,
          mu.module,
          mu.model_name,
          coalesce(p.full_name, p.email, 'Unknown User') as user_name
        from public.model_usage mu
        left join public.profiles p on p.id = mu.user_id
        where mu.created_at >= cutoff
        order by mu.created_at desc
        limit 20
      ) r
    )
  ) into result;
  return result;
end;
$$ language plpgsql security definer;
grant execute on function public.get_model_usage_stats to authenticated;

-- Force Schema Cache Reload (notify PostgREST)
NOTIFY pgrst, 'reload config';
`;

  const handleCopy = () => {
    navigator.clipboard.writeText(setupSQL);
    alert(t.copySuccess);
  };

  const isRlsError = errorType === 'RLS_ERROR';

  return (
    <div className="fixed inset-0 z-[100] bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden relative animate-fade-in-up flex flex-col max-h-[90vh]">
        {onClose && (
            <button onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white z-10">
                <X size={24} />
            </button>
        )}
        
        <div className={`p-6 text-white flex items-center gap-4 shrink-0 ${isRlsError ? 'bg-red-600' : 'bg-indigo-600'}`}>
          <div className="bg-white/20 p-3 rounded-lg">
            {isRlsError ? <AlertTriangle size={32}/> : <Database size={32} />}
          </div>
          <div>
             <h1 className="text-2xl font-bold">{isRlsError ? t.permissionDenied : t.initDbTitle}</h1>
             <p className="text-white/90">
                {isRlsError ? t.permissionDeniedDesc : t.initDbDesc}
             </p>
          </div>
        </div>
        
        <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
          
          <div className="flex items-start gap-3 bg-amber-50 text-amber-900 p-4 rounded-lg border border-amber-200">
             <MailWarning className="shrink-0 mt-1 text-amber-600" />
             <div>
               <p className="font-bold text-lg">{t.fixEmailTitle}</p>
               <p className="text-sm mt-1 mb-2">
                 {t.fixEmailDesc}
               </p>
               <ol className="list-decimal pl-5 space-y-1 text-sm font-medium">
                    <li>Go to <a href="https://supabase.com/dashboard" target="_blank" className="underline hover:text-amber-700">Supabase Dashboard</a> &gt; Authentication &gt; Providers &gt; Email</li>
                    <li>Set <strong>Confirm email</strong> to <span className="font-bold text-red-600 bg-white px-1 rounded border border-red-200">OFF</span></li>
                    <li>Click <strong>Save</strong></li>
                </ol>
             </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm text-white ${isRlsError ? 'bg-red-500' : 'bg-indigo-600'}`}>1</span>
              {t.step1Title}
            </h3>
            <div className="relative group">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs font-mono overflow-x-auto h-48 custom-scrollbar">
                {setupSQL}
              </pre>
              <button 
                onClick={handleCopy}
                className="absolute top-2 right-2 bg-white text-gray-900 px-3 py-1.5 rounded text-xs font-medium flex items-center hover:bg-gray-100 transition-colors"
              >
                <Copy size={12} className="mr-1.5"/> {t.copySql}
              </button>
            </div>
            <p className="text-xs text-gray-500">
                {t.step1Desc}
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
               <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm text-white ${isRlsError ? 'bg-red-500' : 'bg-indigo-600'}`}>2</span>
              {t.step2Title}
            </h3>
            <div className="pl-8">
               <a 
                 href="https://supabase.com/dashboard/project/_/sql" 
                 target="_blank"
                 rel="noreferrer"
                 className={`inline-flex items-center gap-2 text-white px-5 py-2.5 rounded-lg transition-colors font-medium ${isRlsError ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
               >
                 {t.openSqlEditor} <ExternalLink size={16} />
               </a>
            </div>
          </div>
          
          <div className="border-t border-gray-100 pt-6 mt-6 flex justify-between items-center">
             <p className="text-xs text-gray-500">{t.afterRunning}</p>
             <button 
               onClick={handleRetry}
               disabled={isChecking}
               className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
             >
               {isChecking ? <RefreshCw className="animate-spin" size={16} /> : <CheckCircle size={16} />}
               {t.verifyComplete}
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};
