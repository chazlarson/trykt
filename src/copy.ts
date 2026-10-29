const messages: Record<string, string> = {
  future: "That time is still in the future.",
  fields: "Check the fields and try again.",
  "sign-in": "Sign-in failed. Check the email and password.",
  verify: "Verify the email first. The code is in the terminal.",
  "verify-failed": "That code did not work. Request a new one.",
  taken: "Could not create the account. Try a different username.",
  rate: "Too many attempts. Wait and try again.",
  "search-rate": "Search is paused for a minute. Try again shortly.",
  tmdb: "TMDB timed out. Try the search again.",
  "tmdb-limit": "TMDB is rate limiting requests. Try the search again.",
  "tmdb-missing": "TMDB_API_KEY is not set. Add a personal developer key and try the search again.",
  "tmdb-error": "TMDB returned an error. Try the search again.",
  stale: "Showing the saved copy.",
  missing: "That title is not in the log.",
  "list-missing": "That list is not in your log.",
  listed: "That title is already on the list.",
  password: "Password reset failed. Request a new code.",
  confirmed: "Type your username to delete the account.",
  "reset-sent": "If the account exists, the reset code is in the terminal.",
  "password-set": "Password updated. Sign in.",
  verified: "Email verified. Sign in.",
  "signed-up": "If the account is new, the verification code is in the terminal.",
  season: "Season logged.",
  cleared: "Manual logs cleared.",
  removed: "Removed from the log.",
  "import-size": "That file is over 50 MB.",
  "import-type": "Upload a ZIP file.",
  "import-busy": "An import is already running.",
  "import-queued": "Import started. This page updates until it finishes.",
  "import-failed": "Import failed. Try the file again.",
  "import-rate": "Too many imports. Wait and try again.",
  "import-cleared": "Import cleared. You can upload the file again.",
};

export type NoticeCode = keyof typeof messages;

export function messageFor(code: string | undefined): string | null {
  if (!code) return null;
  return messages[code] ?? null;
}

export function episodeLabel(season: number, episode: number): string {
  return `S${season} E${episode}`;
}
