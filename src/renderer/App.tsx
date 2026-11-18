import { useEffect, useState } from 'react';
import { Gallery } from './Gallery';
import { TitleBar } from './TitleBar';

export function App() {
  // Main appends #gallery to the URL only under `pnpm dev` or with HARNESS_GALLERY=1.
  const showGallery = window.location.hash === '#gallery';
  const [version, setVersion] = useState<string>('loading');

  useEffect(() => {
    let active = true;
    window.harness
      .getVersion()
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {
        if (active) setVersion('unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  if (showGallery) {
    return (
      <>
        <TitleBar />
        <Gallery />
      </>
    );
  }

  return (
    <>
      <TitleBar />
      <main>
        <h1>SDD Harness</h1>
        <p>Empty shell. No screens yet.</p>
        <p>
          Version <span data-testid="app-version">{version}</span>
        </p>
      </main>
    </>
  );
}
