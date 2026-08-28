import { Link, Navigate } from 'react-router-dom'
import { useAuthUser } from '../../lib/auth'
import styles from './Account.module.css'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'S'
}

export function Account() {
  const user = useAuthUser()
  if (!user) return <Navigate replace to="/auth" />

  const joined = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(user.joinedAt))
  const planDescription = user.plan === 'Pro Ultra'
    ? 'Maximum video capacity, premium exports, and the fastest rendering priority.'
    : user.plan === 'Pro'
      ? 'More videos, advanced exports, and priority rendering for regular creators.'
      : 'Everything you need to create and keep clear visual explanations.'

  return (
    <div className={`shell ${styles.page}`}>
      <div className={styles.heading}><span className="eyebrow">Account settings</span><h1>My account</h1><p>Profile details, membership, and plan information in one place.</p></div>
      <div className={styles.grid}>
        <section className={styles.profile} aria-labelledby="profile-title">
          <div className={styles.profileHead}><span>{initials(user.name)}</span><div><small>PROFILE</small><h2 id="profile-title">{user.name}</h2><p>{user.email}</p></div></div>
          <dl><div><dt>Full name</dt><dd>{user.name}</dd></div><div><dt>Email address</dt><dd>{user.email}</dd></div><div><dt>Member since</dt><dd>{joined}</dd></div></dl>
          <p className={styles.note}>Profile changes will sync here when account services are connected.</p>
        </section>

        <section className={styles.planCard} aria-labelledby="plan-title">
          <div className={styles.planTop}><div><small>CURRENT PLAN</small><h2 id="plan-title">{user.plan}</h2></div><span>ACTIVE</span></div>
          <p>{planDescription}</p>
          <ul><li><i>✓</i>Scene-by-scene generation</li><li><i>✓</i>Personal video library</li><li><i>✓</i>MP4 export and sharing</li></ul>
          <Link className={styles.upgrade} to="/app/plans"><span>Explore plans</span><b>→</b></Link>
        </section>
      </div>
      <div className={styles.actions}><Link to="/app">← Back to studio</Link><Link to="/app/videos">View my videos →</Link></div>
    </div>
  )
}
