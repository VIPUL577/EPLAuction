import { AdminApp } from './admin/AdminApp';
import { PublicApp } from './public/PublicApp';

// Two experiences in one bundle: /admin (desktop, Cognito login) and everything else (public viewer).
// Admin protection is enforced by the backend (Cognito JWT on every admin API), not by this routing.
export function App() {
  return window.location.pathname.startsWith('/admin') ? <AdminApp /> : <PublicApp />;
}
