import { messageFor } from "@/copy";

export function Notice({ error, notice }: { error?: string; notice?: string }) {
  const text = messageFor(error) ?? messageFor(notice);
  if (!text) return null;
  return (
    <p className="notice" role={error ? "alert" : undefined}>
      {text}
    </p>
  );
}
