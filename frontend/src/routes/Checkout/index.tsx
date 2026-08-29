import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { updateUserPlan, useAuthUser, type AuthUser } from '../../lib/auth'
import styles from './Checkout.module.css'

type PaidPlan = Exclude<AuthUser['plan'], 'Free'>
type CheckoutStatus = 'ready' | 'processing' | 'confirmed'

const checkoutPlans: Record<PaidPlan, { price: string; color: string; videos: number }> = {
  Pro: { price: '19.00', color: 'royal', videos: 10 },
  'Pro Ultra': { price: '39.00', color: 'purple', videos: 20 },
}

const planRank: Record<AuthUser['plan'], number> = { Free: 0, Pro: 1, 'Pro Ultra': 2 }

export function Checkout() {
  const user = useAuthUser()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('plan')
  const plan: PaidPlan | null = requested === 'Pro' || requested === 'Pro Ultra' ? requested : null
  const [status, setStatus] = useState<CheckoutStatus>('ready')
  const timers = useRef<number[]>([])

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), [])

  if (!user) return <Navigate replace to="/auth" />
  if (!plan || (status === 'ready' && planRank[plan] <= planRank[user.plan])) return <Navigate replace to="/app/plans" />

  const details = checkoutPlans[plan]
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('processing')
    timers.current.push(window.setTimeout(() => {
      void updateUserPlan(user, plan, Math.round(Number(details.price) * 100)).then(() => {
        setStatus('confirmed')
        timers.current.push(window.setTimeout(() => navigate('/app/plans', { replace: true, state: { upgradedTo: plan } }), 900))
      }).catch(() => setStatus('ready'))
    }, 850))
  }

  return (
    <main className={`${styles.page} ${styles[details.color]}`}>
      <div aria-hidden="true" className={styles.grid} />
      <header className={styles.header}>
        <Link className={styles.brand} to="/app/plans"><span>S</span><strong>SIMI PAY</strong></Link>
        <span>DEMO CHECKOUT · NO REAL CHARGE</span>
      </header>

      <div className={`shell ${styles.layout}`}>
        <section className={styles.summary}>
          <span className={styles.kicker}>Plan upgrade</span>
          <h1>Upgrade to<br /><em>{plan}.</em></h1>
          <p>Your new color and allowance activate only after this demo payment is confirmed.</p>
          <div className={styles.order}>
            <div><span>PLAN</span><strong>{plan}</strong></div>
            <div><span>ALLOWANCE</span><strong>{details.videos} videos</strong></div>
            <div><span>BILLING</span><strong>Monthly</strong></div>
            <div className={styles.total}><span>TOTAL TODAY</span><strong>${details.price}</strong></div>
          </div>
          <Link className={styles.cancel} to="/app/plans">← Cancel and return to plans</Link>
        </section>

        <section className={styles.paymentCard} aria-labelledby="payment-title">
          <div className={styles.cardHead}><span>SECURE DEMO PAYMENT</span><h2 id="payment-title">Payment details</h2><p>Use the prefilled test card. Do not enter real financial information.</p></div>
          <form className={styles.form} onSubmit={submit}>
            <label><span>Name on card</span><input defaultValue="SIMI TEST USER" required /></label>
            <label><span>Card number</span><input aria-label="Card number" defaultValue="4242 4242 4242 4242" inputMode="numeric" required /></label>
            <div className={styles.split}>
              <label><span>Expiry</span><input aria-label="Expiry date" defaultValue="12/30" inputMode="numeric" required /></label>
              <label><span>CVC</span><input aria-label="CVC" defaultValue="123" inputMode="numeric" required /></label>
            </div>
            <div className={styles.demoNotice}><b>TEST MODE</b><span>No money moves and no card data is saved.</span></div>
            <button className={styles.payButton} disabled={status !== 'ready'} type="submit"><span>{status === 'ready' ? `Pay $${details.price}` : status === 'processing' ? 'Confirming payment…' : 'Payment confirmed'}</span><b aria-hidden="true">{status === 'confirmed' ? '✓' : '→'}</b></button>
          </form>
          <div aria-live="polite" className={`${styles.confirmation} ${status === 'confirmed' ? styles.visible : ''}`} role="status"><span>✓</span><div><strong>Payment confirmed</strong><p>Activating {plan} and returning you to Simi Studio…</p></div></div>
        </section>
      </div>
    </main>
  )
}
