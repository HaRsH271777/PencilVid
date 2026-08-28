-- Run after `supabase db reset` with the Supabase CLI.
begin;
select plan(5);
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'video_jobs', 'video_jobs exists');
select has_table('public', 'videos', 'videos exists');
select has_table('public', 'payment_transactions', 'payments exists');
select policies_are('public', 'profiles', array['users read own profile','users update own profile'], 'profile RLS policies exist');
select * from finish();
rollback;
