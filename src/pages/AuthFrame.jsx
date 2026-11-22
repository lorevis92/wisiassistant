import { Logo, ThemeSwitch } from '../components/Brand'

/** Centered card on the mesh background, for the public account pages (invite, sign-up, no access). */
export default function AuthFrame({ children }) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', padding: '22px 20px' }}>
      <div className="row between"><Logo /><ThemeSwitch /></div>
      <div className="card glow" style={{ width: '100%', maxWidth: 440, margin: 'auto', padding: 30, animation: 'sd-rise .5s var(--ease) both' }}>
        {children}
      </div>
    </div>
  )
}
