export const BETA_MODE = typeof window !== 'undefined'
  && localStorage.getItem('osintview-beta-mode') === 'true';
