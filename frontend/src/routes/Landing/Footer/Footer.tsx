import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink } from '../../../components/Button/Button'
import { useMagnetic, useReveal } from '../../../hooks'
import styles from '../Sections.module.css'

export function LandingFooter() {
  const wordmark = useReveal<HTMLDivElement>()
  const ctaReveal = useReveal<HTMLDivElement>()
  const ctaRef = useMagnetic<HTMLAnchorElement>(.18, 70, 1)

  useEffect(() => {
    const mark = wordmark.ref.current
    if (!mark) return
    const update = () => {
      const bounds = mark.getBoundingClientRect()
      const progress = Math.min(1, Math.max(0, (window.innerHeight - bounds.top) / (window.innerHeight * .45)))
      mark.style.setProperty('--footer-shift', `${Math.round((1 - progress) * 34)}px`)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [wordmark.ref])

  return (
    <>
      <section className={styles.ctaSection}>
        <div className={`shell ${styles.ctaBand} ${styles.reveal} ${ctaReveal.className}`} ref={ctaReveal.ref}>
          <div><h2>What do you want to understand?</h2><p>Turn the next question on your mind into a visual explanation.</p></div>
          <div className={styles.ctaAction}><ButtonLink arrow className={styles.ctaButton} ref={ctaRef} to="/app" viewTransition>Open the studio</ButtonLink><small>No card needed · most videos take ~6 min</small></div>
        </div>
      </section>
      <footer className={styles.footer}>
        <div className="shell">
          <div className={styles.footerGrid}>
            <div className={styles.footerBrand}><Link to="/"><span>S</span><b>SIMI STUDIO</b></Link><p>Ideas, made visible.</p><div className={styles.socials}><a href="#linkedin" aria-label="Simi Studio on LinkedIn">in</a><a href="#x" aria-label="Simi Studio on X">𝕏</a><a href="#youtube" aria-label="Simi Studio on YouTube">▶</a></div></div>
            <div><h3>Product</h3><Link to="/app">New video</Link><Link to="/app/videos">My videos</Link><a href="#features">Features</a></div>
            <div><h3>Explore</h3><a href="#how">How it works</a><a href="#examples">Examples</a><Link to="/app/videos">Video library</Link></div>
            <div><h3>Company</h3><a href="#about">About</a><a href="#contact">Contact</a><a href="#privacy">Privacy</a></div>
          </div>
          <div className={styles.legal}><span>© 2026 Simi Studio</span><span>Privacy · Terms</span><span><i />All systems operational</span></div>
          <div className={`${styles.footerWordmark} ${styles.reveal} ${wordmark.className}`} ref={wordmark.ref}>SIMI STUDIO</div>
        </div>
      </footer>
    </>
  )
}
