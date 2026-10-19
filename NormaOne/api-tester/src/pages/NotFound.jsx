import { Construction } from 'lucide-react'

/**
 * What an address with no screen shows. The reference's Placeholder also stood in for unbuilt
 * screens; every NormaOne endpoint has a screen, so only the not-found half is kept.
 */
export default function NotFound() {
  return (
    <div className="page">
      <section className="card placeholder">
        <Construction size={26} aria-hidden="true" />
        <h2 className="card-title">Page not found</h2>
        <p className="placeholder-text">No screen answers this address. Pick one from the side panel.</p>
      </section>
    </div>
  )
}
