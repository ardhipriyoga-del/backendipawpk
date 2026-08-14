import { useEffect } from 'react';

function OpenMainApplication() {
  useEffect(() => {
    // The complete application is registered at the root preview path.
    // Keep this legacy path useful instead of leaving the scaffold visible.
    window.location.replace('/#/login');
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0ea5b7] text-white">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
        <p className="text-sm font-medium">Membuka IP Admission Workspace...</p>
      </div>
    </div>
  );
}

function App() {
  return <OpenMainApplication />;
}

export default App;
