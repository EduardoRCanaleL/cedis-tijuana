import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { email, nombre, rol } = await req.json()

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Intentar invitar — si ya existe el usuario, continuar de todos modos
  const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email)
  if (inviteError && !inviteError.message.includes('already been registered')) {
    return new Response(
      JSON.stringify({ error: inviteError.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Insertar o actualizar rol
  const { error: rolError } = await supabaseAdmin
    .from('user_roles')
    .upsert({ email: email.toLowerCase(), nombre, rol, activo: true }, { onConflict: 'email' })

  if (rolError) return new Response(
    JSON.stringify({ error: rolError.message }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )

  return new Response(
    JSON.stringify({ ok: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})