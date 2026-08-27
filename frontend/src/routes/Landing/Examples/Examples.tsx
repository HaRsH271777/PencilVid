import { useEffect, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useReveal, useSpotlight } from '../../../hooks'
import { listVideos, videoStreamUrl } from '../../../lib/api'
import type { VideoSummary } from '../../../lib/types'
import { DemoArt, type DemoKind } from '../Hero/Hero'
import styles from '../Sections.module.css'

const EXAMPLES: ReadonlyArray<{ title: string; category: string; duration: string; kind: DemoKind }> = [
  { title: 'How do F1 cars corner so fast?', category: 'Engineering', duration: '1:32', kind: 'car' },
  { title: 'How does a compiler understand code?', category: 'Computer science', duration: '2:11', kind: 'compiler' },
  { title: "Why doesn't the Moon fall to Earth?", category: 'Science', duration: '2:05', kind: 'moon' },
]

export function LandingExamples() {
  const reveal = useReveal<HTMLDivElement>()
  const [videos, setVideos] = useState<VideoSummary[]>([])

  useEffect(() => {
    let current = true
    listVideos().then((videos) => {
      if (current) setVideos(videos.filter((video) => video.status === 'ready').slice(0, 3))
    }).catch(() => undefined)
    return () => { current = false }
  }, [])

  return (
    <section className={styles.section} id="examples">
      <div className="shell">
        <div className={styles.sectionHead}>
          <div className="eyebrow">Examples</div>
          <h2>See ideas become explanations</h2>
          <p>Three questions, shaped into clear visual stories.</p>
        </div>
        <div className={`${styles.exampleGrid} ${styles.reveal} ${reveal.className}`} ref={reveal.ref}>
          <ExampleCard {...EXAMPLES[0]} big poster={videos[0]?.posterUrl} to={videos[0] ? `/app/videos/${videos[0].id}` : '/app/videos'} videoUrl={videos[0] ? videoStreamUrl(videos[0].id) : undefined} />
          <div className={styles.exampleSide}>
            <ExampleCard {...EXAMPLES[1]} poster={videos[1]?.posterUrl} to={videos[1] ? `/app/videos/${videos[1].id}` : '/app/videos'} videoUrl={videos[1] ? videoStreamUrl(videos[1].id) : undefined} />
            <ExampleCard {...EXAMPLES[2]} poster={videos[2]?.posterUrl} to={videos[2] ? `/app/videos/${videos[2].id}` : '/app/videos'} videoUrl={videos[2] ? videoStreamUrl(videos[2].id) : undefined} />
          </div>
        </div>
      </div>
    </section>
  )
}

function ExampleCard({ title, category, duration, kind, big = false, poster, to, videoUrl }: typeof EXAMPLES[number] & { big?: boolean; poster?: string; to: string; videoUrl?: string }) {
  const spotlight = useSpotlight<HTMLAnchorElement>()
  const navigate = useNavigate()
  const transitionName = `video-${kind}`

  const playPreview = (event: PointerEvent<HTMLAnchorElement>) => {
    if (!window.matchMedia('(hover:hover) and (prefers-reduced-motion:no-preference)').matches) return
    event.currentTarget.querySelector('video')?.play().catch(() => undefined)
  }

  const stopPreview = (event: PointerEvent<HTMLAnchorElement>) => {
    event.currentTarget.style.transform = ''
    const video = event.currentTarget.querySelector('video')
    video?.pause()
    if (video) video.currentTime = 0
  }

  const tilt = (event: PointerEvent<HTMLAnchorElement>) => {
    if (!window.matchMedia('(hover:hover) and (prefers-reduced-motion:no-preference)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width - .5
    const y = (event.clientY - bounds.top) / bounds.height - .5
    event.currentTarget.style.transform = `rotateX(${-y * 3}deg) rotateY(${x * 3}deg)`
  }

  const openWithTransition = (event: MouseEvent<HTMLAnchorElement>) => {
    const transitionDocument = document as Document & { startViewTransition?: (update: () => void) => void }
    if (!transitionDocument.startViewTransition) return
    event.preventDefault()
    transitionDocument.startViewTransition(() => navigate(to))
  }

  return (
    <Link className={`${styles.exampleCard} ${big ? styles.exampleBig : ''}`} onClick={openWithTransition} onPointerEnter={playPreview} onPointerLeave={stopPreview} onPointerMove={tilt} ref={spotlight} style={{ viewTransitionName: transitionName } as CSSProperties} to={to}>
      <span className={styles.exampleMedia}>
        <DemoArt kind={kind} />
        {videoUrl && <video aria-hidden="true" className={styles.exampleVideo} loop muted onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= 3) event.currentTarget.currentTime = 0 }} playsInline poster={poster} preload="metadata" src={videoUrl} />}
        <span className={styles.play}>▶</span>
        <span className={styles.duration}>{duration}</span>
      </span>
      <span className={styles.exampleBody}>
        <span className={styles.category}>{category}</span>
        <strong>{title}</strong>
      </span>
      <span className={styles.cardButton}>Watch video</span>
    </Link>
  )
}
