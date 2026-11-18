import { useEffect, useState } from 'react';
import { TitleBar } from './TitleBar';

export function App() {
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
