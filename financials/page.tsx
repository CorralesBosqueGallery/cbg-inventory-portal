import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FinancialsClient from '@/components/FinancialsClient'

export default async function FinancialsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: member } = await supabase
    .from('members')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()

  if (!member || !['admin', 'finance', 'it'].includes(member.role)) {
    redirect('/dashboard')
  }

  return <FinancialsClient />
}
