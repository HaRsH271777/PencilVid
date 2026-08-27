import { useLayoutEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { Header } from './components/Header'
import { ProductionProvider } from './components/ProductionProvider'
import { useProduction } from './hooks/useProduction'
import { Home } from './routes/Home'
import { Landing } from './routes/Landing'
import { Library } from './routes/Library'
import { Production } from './routes/Production'
import { VideoDetail } from './routes/VideoDetail'
import styles from './App.module.css'

function StudioLayout() {
  const location = useLocation()
  const { generating, job } = useProduction()
  const activeScene = job?.scenes.find((scene) => scene.status === 'active')
    ?? [...(job?.scenes ?? [])].reverse().find((scene) => scene.status === 'done')

  return (
    <>
      <Header
        jobActive={generating}
        jobScene={activeScene?.title || job?.detail || 'Creating explanation'}
        jobProgress={Math.max(3, job?.percent ?? 0)}
      />
      <main><div className={styles.screen} key={location.pathname}><Outlet /></div></main>
    </>
  )
}

function LegacyRedirect({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate replace to={`${to}${location.search}`} />
}

function LegacyVideoRedirect() {
  const { id = '' } = useParams()
  return <Navigate replace to={`/app/videos/${encodeURIComponent(id)}`} />
}

function AppRoutes() {
  const location = useLocation()

  useLayoutEffect(() => {
    if (!location.hash) window.scrollTo(0, 0)
  }, [location.hash, location.pathname])

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<StudioLayout />}>
        <Route index element={<Home />} />
        <Route path="create" element={<Production />} />
        <Route path="videos" element={<Library />} />
        <Route path="videos/:id" element={<VideoDetail />} />
      </Route>
      <Route path="/create" element={<LegacyRedirect to="/app/create" />} />
      <Route path="/videos" element={<LegacyRedirect to="/app/videos" />} />
      <Route path="/videos/:id" element={<LegacyVideoRedirect />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  )
}

function App() {
  return <ProductionProvider><AppRoutes /></ProductionProvider>
}

export default App
