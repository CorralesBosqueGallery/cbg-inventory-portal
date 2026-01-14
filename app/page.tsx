'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Member } from '@/lib/supabase';
import InventoryPortal from '@/components/InventoryPortal';

export default function HomePage() {
  const router = useRouter();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login');
      } else if (session?.user) {
        await loadMember(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      router.push('/login');
      return;
    }

    await loadMember(session.user.id);
  };

  const loadMember = async (userId: string) => {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('auth_user_id', userId)
      .single();

    if (error || !data) {
      await supabase.auth.signOut();
      router.push('/login');
      return;
    }

    setMember(data);
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🎨</div>
          <div className="text-xl text-gray-600">Loading Gallery Portal...</div>
        </div>
      </div>
    );
  }

  if (!member) {
    return null;
  }

  return <InventoryPortal member={member} onLogout={handleLogout} />;
}
