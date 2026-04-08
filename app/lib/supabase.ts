import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://bdxnmrtywzfjtuvmeizf.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkeG5tcnR5d3pmanR1dm1laXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTgzMDgsImV4cCI6MjA5MDczNDMwOH0.uCJcAoX0w2uPYXGVShhss0zUGZ_N45sj_Qi2mqDI_SM'

export const supabase = createClient(supabaseUrl, supabaseKey)