#!/usr/bin/env node
/**
 * seed-dev.js — create the 6 BeeHive dev users via Supabase Admin API.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/seed-dev.js
 *
 * Users are created with email_confirm=true (no verification email needed).
 * sapho@xspark.co.za is promoted to admin after creation.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DEV_USERS = [
  { email: 'sapho@xspark.co.za',      name: 'Sapho',  role: 'admin' },
  { email: 'dev1@xspark.co.za',        name: 'Dev One' },
  { email: 'dev2@xspark.co.za',        name: 'Dev Two' },
  { email: 'dev3@xspark.co.za',        name: 'Dev Three' },
  { email: 'dev4@xspark.co.za',        name: 'Dev Four' },
  { email: 'dev5@xspark.co.za',        name: 'Dev Five' },
]

async function main() {
  console.log('Seeding dev users…\n')

  for (const u of DEV_USERS) {
    // Create or update the auth user
    const { data: existing } = await supabase.auth.admin.listUsers()
    const found = existing?.users?.find(x => x.email === u.email)

    let userId
    if (found) {
      userId = found.id
      console.log(`  ↩  ${u.email} already exists (${userId})`)
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: u.email,
        email_confirm: true,
        user_metadata: { full_name: u.name },
      })
      if (error) { console.error(`  ✗  ${u.email}: ${error.message}`); continue }
      userId = data.user.id
      console.log(`  ✓  ${u.email} created (${userId})`)
    }

    // Upsert profile
    await supabase.from('profiles').upsert({ id: userId, full_name: u.name }, { onConflict: 'id' })

    // Promote admin
    if (u.role === 'admin') {
      const { data: adminRole } = await supabase.from('roles').select('id').eq('name', 'admin').single()
      if (adminRole) {
        await supabase.from('user_roles').upsert({ user_id: userId, role_id: adminRole.id }, { onConflict: 'user_id,role_id' })
        console.log(`     → promoted to admin`)
      }
    }
  }

  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
