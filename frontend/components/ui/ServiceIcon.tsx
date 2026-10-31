import {
  Database,
  FolderOpen,
  Globe,
  Layers,
  Radio,
  Terminal,
  type LucideIcon,
} from "lucide-react";

import type { ServiceId } from "../../lib/types";

const ICONS: Record<ServiceId, LucideIcon> = {
  ssh: Terminal,
  http: Globe,
  ftp: FolderOpen,
  telnet: Radio,
  redis: Layers,
  mysql: Database,
};

export function ServiceIcon({
  id,
  className = "size-4",
}: {
  id: ServiceId;
  className?: string;
}) {
  const Icon = ICONS[id];
  return <Icon className={className} strokeWidth={1.75} />;
}
