import { afterEach, describe, expect, it, vi } from "vitest";
import { searchCatalog } from "./catalog/store";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search cache", () => {
  it("does not call TMDB again for the same query within the hour", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      expect(url.startsWith("https://api.themoviedb.org/3/search/multi")).toBe(true);
      expect(url).toContain("api_key=test-key");
      return new Response(
        JSON.stringify({
          results: [
            {
              media_type: "movie",
              id: 550,
              title: "Example",
              release_date: "1999-10-15",
              overview: "A log entry.",
              poster_path: "/poster.jpg",
              backdrop_path: null,
            },
            {
              media_type: "tv",
              id: 1396,
              name: "Example Show",
              first_air_date: "2008-01-20",
              overview: "A show.",
              poster_path: "/show.jpg",
            },
            { media_type: "person", id: 1, name: "Someone" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const first = await searchCatalog("user-a", "  Example   Show ");
    const second = await searchCatalog("user-a", "example show");
    expect(calls).toBe(1);
    expect(first.notice).toBeNull();
    expect(first.results.map((row) => row.kind).sort()).toEqual(["movie", "show"]);
    expect(second.results.map((row) => row.id).sort()).toEqual(first.results.map((row) => row.id).sort());
  });
});
