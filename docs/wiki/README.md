# Wiki sources

These pages are the source of truth for the GitHub wiki. They are kept in the main repo so
documentation changes are reviewed alongside code changes.

To publish to the GitHub wiki of the hosting repo (the wiki git repo exists once the wiki
has at least one page created through the UI):

```sh
git clone https://github.com/<owner>/atomicmarket-contract.wiki.git /tmp/market-wiki
cp docs/wiki/*.md /tmp/market-wiki/      # README.md is harmless to include
cd /tmp/market-wiki
git add -A && git commit -m "Sync wiki from docs/wiki" && git push
```

Page links between the files use wiki-style page names (e.g. `[Royalty Splits](Royalty-Splits)`), which
resolve on the GitHub wiki. When viewing these files inside the repo, append `.md` mentally.
