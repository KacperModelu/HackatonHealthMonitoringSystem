import { useEffect, useState } from 'react';
import Login from './screens/Login.jsx';
import UserForm from './screens/UserForm.jsx';
import Dashboard from './screens/Dashboard.jsx';

// Tiny hash router: #/ (login), #/new (add user), #/crew/<id> (dashboard).
function parse(hash) {
  const m = hash.match(/^#\/crew\/(\d+)/);
  if (m) return { screen: 'dashboard', crewId: Number(m[1]) };
  if (hash.startsWith('#/new')) return { screen: 'form' };
  const sel = hash.match(/[?&]selected=(\d+)/);
  return { screen: 'login', selected: sel ? Number(sel[1]) : null };
}


export default function App() {
  const [route, setRoute] = useState(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  if (route.screen === 'form') return <UserForm />;
  if (route.screen === 'dashboard') return <Dashboard key={route.crewId} crewId={route.crewId} />;
  return <Login selected={route.selected} />;
}
