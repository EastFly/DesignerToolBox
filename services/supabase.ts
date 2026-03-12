
import { createClient } from '@supabase/supabase-js';

// ------------------------------------------------------------------
// CONFIGURATION REQUIRED
// Please replace the values below with your project details from Supabase Dashboard.
// ------------------------------------------------------------------

const SUPABASE_URL = 'https://urhguhdryhrgvvhfbxvx.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyaGd1aGRyeWhyZ3Z2aGZieHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2NjkzNjgsImV4cCI6MjA4NTI0NTM2OH0.6NO7D-vM8X8zC85YOEV92G0xD0UPWx9tQUfZVHcaZwE';

// ------------------------------------------------------------------

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const BUCKET_NAME = 'designflow-assets';
export const TABLE_TASKS = 'tasks';
export const TABLE_TYPES = 'task_types';
export const TABLE_PROFILES = 'profiles';
export const TABLE_ROLES = 'roles';
export const TABLE_PRODUCTS = 'products';
export const TABLE_STYLE_DICE = 'style_dice';
export const TABLE_MIDNIGHT_MISSIONS = 'midnight_missions'; // New Table
export const TABLE_MODEL_USAGE = 'model_usage';
