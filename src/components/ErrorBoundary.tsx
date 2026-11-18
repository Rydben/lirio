// Si una página o pestaña falla al pintarse, en vez de dejar la ventana en negro se enseña un aviso con «Volver»
// y el error queda apuntado en el Diario de Lirio.
import { Component, type ReactNode } from 'react'
import { api } from '../lib/api'

interface Props { children: ReactNode; where: string; onBack?: () => void }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    api.uiError(`${this.props.where}: ${error?.message ?? String(error)}`.slice(0, 300)).catch(() => {})
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="panel banner-warn" role="alert">
        <div>
          <b>Esta parte de Lirio ha fallado al mostrarse.</b>
          <p className="muted small">Lo he apuntado en el Diario. El resto de Lirio sigue funcionando.</p>
          <p className="muted small mono">{this.state.error.message}</p>
        </div>
        <button className="btn btn--primary" onClick={() => { this.setState({ error: null }); this.props.onBack?.() }}>Volver</button>
      </section>
    )
  }
}
