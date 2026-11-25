import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unexpected rendering error." };
  }

  componentDidCatch(error, info) {
    console.error("UI ErrorBoundary caught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-shell">
          <div className="surface-card error-boundary-card">
            <span className="section-eyebrow">Application Recovery</span>
            <h1>Something interrupted this view</h1>
            <p className="muted-caption">{this.state.message}</p>
            <div className="hero-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.location.reload()}
              >
                Reload Workspace
              </button>
              <a href="/" className="btn btn-secondary">
                Return Home
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
