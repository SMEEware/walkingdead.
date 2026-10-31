import { ControlPanel } from "../components/dashboard/ControlPanel";
import { HeroTitle } from "../components/dashboard/HeroTitle";
import { LiveFeed } from "../components/dashboard/LiveFeed";
import { ServicesPanel } from "../components/dashboard/ServicesPanel";
import { Specimen } from "../components/dashboard/Specimen";
import { StatsPanel } from "../components/dashboard/StatsPanel";

export default function Home() {
  return (
    <div className="command-workspace">
      <HeroTitle />
      <div className="command-grid">
        <aside className="command-controls"><ControlPanel /><ServicesPanel /></aside>
        <Specimen />
        <aside className="command-telemetry"><StatsPanel /><LiveFeed /></aside>
      </div>
    </div>
  );
}
