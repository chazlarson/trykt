import { tmdbImageUrl } from "@/catalog/tmdb";

export function Poster({ path, small = false }: { path: string | null; small?: boolean }) {
  const src = tmdbImageUrl(path, small ? "w185" : "w342");
  if (!src) return <div className={small ? "poster small empty" : "poster empty"}>No poster</div>;
  return <img className={small ? "poster small" : "poster"} src={src} alt="" />;
}
