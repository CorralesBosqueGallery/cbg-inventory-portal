import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserRole = 'member' | 'admin' | 'finance' | 'it';
export type MemberType = 'member' | 'consignment';

export interface Member {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string;
  preferred_name: string | null;
  phone: string | null;
  role: UserRole;
  member_type: MemberType;
  status: 'active' | 'inactive' | 'archived';
  commission_rate: number;
  created_at: string;
  updated_at: string;
}
