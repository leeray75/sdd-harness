import { useEffect, useState } from 'react';
import './titlebar.css';

/** The three caption buttons: Minimize, Maximize or Restore, and Close. */
function CaptionButtons({ maximized }: { maximized: boolean }) {
  const { window: controls } = window.harness;
  return (
    <div className="titlebar__caption">
      <button
        type="button"
        className="titlebar__caption-button"
        aria-label="Minimize"
        onClick={() => void controls.minimize()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M1 6h10" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="titlebar__caption-button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void controls.toggleMaximize()}
      >
        {maximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3.5 1.5h7v7" stroke="currentColor" />
            <rect x="1.5" y="3.5" width="7" height="7" stroke="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="9" height="9" stroke="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="titlebar__caption-button titlebar__caption-button--close"
        aria-label="Close"
        onClick={() => void controls.close()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" />
        </svg>
      </button>
    </div>
  );
}

export function TitleBar() {
  const { platform, window: controls } = window.harness;
  const isMac = platform === 'darwin';
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    controls
      .isMaximized()
      .then((value) => {
        if (active) setMaximized(value);
      })
      .catch(() => {
        // Keep the default (not maximized) if the state cannot be read.
      });
    const unsubscribe = controls.onMaximizedChange((value) => {
      if (active) setMaximized(value);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [controls]);

  return (
    <header className={isMac ? 'titlebar titlebar--mac' : 'titlebar'}>
      <div className="titlebar__mark">
        <svg
          className="titlebar__icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M4 6h10M4 12h16M4 18h7" />
          <circle cx="18" cy="6" r="2" />
        </svg>
        <span>SDD Harness</span>
      </div>
      <nav className="titlebar__location" aria-label="Location" />
      <div className="titlebar__spacer" />
      {isMac ? null : <CaptionButtons maximized={maximized} />}
    </header>
  );
}
