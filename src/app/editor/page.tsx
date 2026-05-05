"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { localStore, newSongId } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default function NewEditorPage() {
  const router = useRouter();
  useEffect(() => {
    const id = newSongId();
    const now = new Date().toISOString();
    localStore.upsertSong({
      id,
      user_id: null,
      title: "",
      content: "",
      tags: [],
      created_at: now,
      updated_at: now,
    });
    router.replace(`/editor/${id}?guest=1`);
  }, [router]);
  return null;
}
