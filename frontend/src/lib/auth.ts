import type { Session, User } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'

export type PlanName = 'Free' | 'Pro' | 'Pro Ultra'

export interface AuthUser {
  id?: string
  name: string
  email: string
  plan: PlanName
  joinedAt: string
  avatarUrl?: string
}

export interface AuthResult {
  user: AuthUser | null
  needsEmailConfirmation: boolean
}

const STORAGE_KEY = 'simi-studio-user'
const AUTH_EVENT = 'simi-auth-change'
let cachedRaw: string | null | undefined
let cachedUser: AuthUser | null = null
let authReady = !supabase

function normalizePlan(value: unknown): PlanName {
  if (value === 'pro_ultra' || value === 'Pro Ultra') return 'Pro Ultra'
  if (value === 'pro' || value === 'Pro') return 'Pro'
  return 'Free'
}

function readUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  // Supabase sessions are authoritative. Never revive a legacy demo-mode user
  // from localStorage while the SDK is still restoring its real session.
  if (supabase) return cachedUser
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === cachedRaw) return cachedUser
  cachedRaw = raw
  if (!raw) return (cachedUser = null)
  try {
    const value = JSON.parse(raw) as Partial<AuthUser>
    cachedUser = value.name && value.email ? {
      id: value.id,
      name: value.name,
      email: value.email,
      plan: normalizePlan(value.plan),
      joinedAt: value.joinedAt || new Date().toISOString(),
      avatarUrl: value.avatarUrl,
    } : null
  } catch {
    cachedUser = null
  }
  return cachedUser
}

function publishUser(user: AuthUser | null) {
  if (user) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  else window.localStorage.removeItem(STORAGE_KEY)
  cachedRaw = undefined
  cachedUser = user
  window.dispatchEvent(new Event(AUTH_EVENT))
}

function subscribe(callback: () => void) {
  window.addEventListener(AUTH_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(AUTH_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

async function userFromSupabase(user: User): Promise<AuthUser> {
  const fallbackName = String(user.user_metadata.full_name || user.email?.split('@')[0] || 'Simi Creator')
  if (!supabase) return { id: user.id, name: fallbackName, email: user.email || '', plan: 'Free', joinedAt: user.created_at }
  const { data } = await supabase.from('profiles').select('full_name, avatar_url, current_plan_id, created_at').eq('id', user.id).maybeSingle()
  return {
    id: user.id,
    name: data?.full_name || fallbackName,
    email: user.email || '',
    plan: normalizePlan(data?.current_plan_id),
    joinedAt: data?.created_at || user.created_at,
    avatarUrl: data?.avatar_url || undefined,
  }
}

async function syncSession(session: Session | null) {
  if (!session?.user) {
    authReady = true
    publishUser(null)
    return null
  }
  const user = await userFromSupabase(session.user)
  authReady = true
  publishUser(user)
  return user
}

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => syncSession(data.session))
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => void syncSession(session), 0)
  })
}

export function useAuthUser() {
  return useSyncExternalStore(subscribe, readUser, () => null)
}

export function useAuthReady() {
  return useSyncExternalStore(subscribe, () => authReady, () => !supabase)
}

export function setAuthUser(user: AuthUser) {
  publishUser(user)
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) {
    const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Simi Creator'
    const user = { name, email, plan: 'Free' as const, joinedAt: new Date().toISOString() }
    publishUser(user)
    return { user, needsEmailConfirmation: false }
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { user: await syncSession(data.session), needsEmailConfirmation: false }
}

export async function signUp(name: string, email: string, password: string): Promise<AuthResult> {
  if (!supabase) {
    const user = { name, email, plan: 'Free' as const, joinedAt: new Date().toISOString() }
    publishUser(user)
    return { user, needsEmailConfirmation: false }
  }
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
  if (error) throw error
  return { user: data.session ? await syncSession(data.session) : null, needsEmailConfirmation: !data.session }
}

export async function updateUserPlan(user: AuthUser, plan: PlanName, amountCents = 0) {
  if (!supabase) {
    publishUser({ ...user, plan })
    return
  }
  const planId = plan === 'Pro Ultra' ? 'pro_ultra' : plan.toLowerCase()
  const { error } = await supabase.rpc('complete_demo_checkout', { target_plan: planId, amount_cents: amountCents })
  if (error) throw error
  const { data: { session } } = await supabase.auth.getSession()
  await syncSession(session)
}

export async function clearAuthUser() {
  if (supabase) {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }
  publishUser(null)
}

export { isSupabaseConfigured }
