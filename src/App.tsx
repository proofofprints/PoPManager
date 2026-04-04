import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import Miners from "./pages/Miners";
import Settings from "./pages/Settings";
import MinerDetail from "./pages/MinerDetail";

function App() {
  return (
    <Router>
      <div className="flex h-screen bg-dark-950">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/miners" element={<Miners />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/miner/:ip" element={<MinerDetail />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
