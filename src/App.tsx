import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { check } from "@tauri-apps/plugin-updater";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import MinerList from "./pages/MinerList";
import Settings from "./pages/Settings";
import MinerDetail from "./pages/MinerDetail";
import Alerts from "./pages/Alerts";
import Pools from "./pages/Pools";
import MobileMinerList from "./pages/MobileMinerList";
import MobileMinerDetail from "./pages/MobileMinerDetail";
import { ProfitabilityProvider } from "./context/ProfitabilityContext";
import { AlertProvider } from "./context/AlertContext";

function App() {
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      check()
        .then((update) => {
          if (update) {
            setUpdateAvailable(update.version);
          }
        })
        .catch(console.error);
    }, 10000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ProfitabilityProvider>
      <AlertProvider>
        <Router>
          <div className="flex h-screen bg-dark-950 flex-col">
            {updateAvailable && (
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-primary-700/90 text-white text-xs">
                <span>
                  A new version ({updateAvailable}) is available.
                </span>
                <button
                  onClick={() => setUpdateAvailable(null)}
                  className="ml-4 text-white/70 hover:text-white transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}
            <div className="flex flex-1 overflow-hidden">
              <Sidebar />
              <main className="flex-1 overflow-auto">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/miners" element={<MinerList />} />
                  <Route path="/mobile-miners" element={<MobileMinerList />} />
                  <Route path="/mobile-miners/:deviceId" element={<MobileMinerDetail />} />
                  <Route path="/pools" element={<Pools />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/miner/:ip" element={<MinerDetail />} />
                  <Route path="/alerts" element={<Alerts />} />
                </Routes>
              </main>
            </div>
          </div>
        </Router>
      </AlertProvider>
    </ProfitabilityProvider>
  );
}

export default App;
