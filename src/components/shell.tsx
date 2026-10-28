import Link from "next/link";
import { Mark } from "./mark";

export function Shell({
  username,
  children,
}: {
  username: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <header className="bar">
        <Link className="brand" href="/">
          <Mark />
          <span className="wordmark">trykt</span>
        </Link>
        {username ? (
          <>
            <nav className="nav">
              <Link href="/history">History</Link>
              <Link href="/watchlist">Watchlist</Link>
              <Link href="/lists">Lists</Link>
              <Link href="/shelf">Shelf</Link>
            </nav>
            <form className="search" action="/search" method="get">
              <label className="sr" htmlFor="q">Search</label>
              <input id="q" name="q" placeholder="Movie or show" />
            </form>
            <Link href="/account">{username}</Link>
          </>
        ) : (
          <nav className="nav">
            <Link href="/sign-in">Sign in</Link>
            <Link href="/sign-up">Create account</Link>
          </nav>
        )}
      </header>
      <main>{children}</main>
      <footer className="footer">
        <div className="brand">
          <Mark />
          <span className="wordmark">trykt</span>
        </div>
        <img className="tmdb-logo" src="/tmdb-primary-short.svg" alt="TMDB" />
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <Link href="/about">About</Link>
      </footer>
    </div>
  );
}
