import { createNavigationContainerRef } from '@react-navigation/native';

// Lets code outside any screen's own navigation prop (push-notification tap
// handlers, which can fire before any screen has mounted) still navigate.
export const navigationRef = createNavigationContainerRef<any>();

export function navigate(name: string, params?: object) {
  if (navigationRef.isReady()) {
    const nav = navigationRef as unknown as { navigate: (name: string, params?: object) => void };
    nav.navigate(name, params);
  }
}
