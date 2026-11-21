import React from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Erro inesperado na interface.',
    };
  }

  override componentDidCatch(error: Error) {
    console.error('Zia AI ErrorBoundary:', error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="h-[100dvh] w-full bg-[#090d16] text-slate-100 flex items-center justify-center p-5">
          <div className="max-w-sm w-full rounded-3xl bg-[#131b2e] border border-sky-400/30 p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-sky-300" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-white">Zia AI se recuperou de um erro</h2>
              <p className="text-xs text-slate-300 leading-relaxed">{this.state.message}</p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-sky-400 to-purple-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reiniciar Zia AI</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
