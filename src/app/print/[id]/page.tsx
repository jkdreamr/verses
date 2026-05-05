import { PrintView } from "@/components/PrintView";

export default function PrintPage({
  params,
}: {
  params: { id: string };
}) {
  return <PrintView songId={params.id} />;
}
