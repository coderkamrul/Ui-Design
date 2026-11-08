import EditorShell from "@/components/EditorShell";

/**
 * Editor route. The shell loads the document for this id via
 * lib/persistence.js (localStorage locally, Supabase when configured),
 * autosaves silently, and the URL is the plain /file/<id> form
 * (page/selection URL segments remain a later nicety).
 */
export default async function FilePage({ params }) {
  const { id } = await params;
  return <EditorShell fileId={id} />;
}
