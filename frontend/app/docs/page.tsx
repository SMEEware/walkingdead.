import type { Metadata } from "next";

import { ApiDocs } from "../../components/docs/ApiDocs";

export const metadata: Metadata = {
  title: "API docs — Walking Dead",
  description: "Management API reference for the Walking Dead honeypot: monitors, live attack stream, threat intelligence and blocklists.",
};

export default function DocsPage() {
  return <ApiDocs />;
}
