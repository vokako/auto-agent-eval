import { BrowserRouter, Routes, Route } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import JobPage from "./pages/JobPage";
import ComparePage from "./pages/ComparePage";
import "./style.css";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/jobs/:config/:timestamp" element={<JobPage />} />
          <Route path="/compare" element={<ComparePage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
