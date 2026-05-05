import { Suspense } from "react";
import { Editor } from "@/components/editor/Editor";

export const dynamic = "force-dynamic";

export default function EditorPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <Suspense fallback={null}>
      <Editor songId={params.id} />
    </Suspense>
  );
}
