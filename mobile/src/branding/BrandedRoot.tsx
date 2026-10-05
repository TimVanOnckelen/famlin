import React, { useEffect, useState } from 'react';
import { loadCachedBranding } from './index';

// The registered root component (see index.js). Registration has to be
// synchronous, but the app itself must not be evaluated until the cached
// brand is applied to `colors`: ES imports are hoisted, so a static
// `import App` here would run every screen's StyleSheet.create() with the
// default palette first. Hence the require() after the await. Renders
// nothing in the meantime — the native splash screen is still up, and the
// AsyncStorage/SecureStore read takes a few milliseconds.
export default function BrandedRoot() {
  const [App, setApp] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    loadCachedBranding().finally(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      setApp(() => require('../../App').default);
    });
  }, []);

  return App ? <App /> : null;
}
