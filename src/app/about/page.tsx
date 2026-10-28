import { Mark } from "@/components/mark";

export default function AboutPage() {
  return (
    <>
      <h1 className="brand">
        <Mark />
        <span className="wordmark">trykt</span>
      </h1>
      <p>A private log of movies and shows. History stays on the account that wrote it.</p>
      <img className="tmdb-logo" src="/tmdb-primary-short.svg" alt="TMDB" />
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      <p>Episode order follows TMDB.</p>
    </>
  );
}
