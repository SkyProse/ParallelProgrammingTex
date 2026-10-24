# Upstream integration audit

Integration date: **2026-10-24**. This working edition combines the English upstream, the complete Russian source snapshot and Concurrency Theatre without changing either original upstream or the existing feature branch. It is not a new official ITMO publication.

## Pinned inputs

| Input | Commit | Source date | Role |
|---|---|---|---|
| `SkyProse/ParallelProgrammingTex` | `1c53d6eb08a7d0041a6f54728b6ba90a59507454` | 2020-02-19 | Previous default branch |
| `s70c3/ParallelProgrammingTexEn` | `9e68958eb5885e0ad8e948570d49e096ad2366ee` | 2020-02-26 | English changes: 39 commits beyond the old default |
| `shilko2013/ParallelProgrammingTex` | `53535f92db505a5d0442dca5a3918fe3ea78189a` | 2021-11-05 | Complete Russian snapshot and additional material |
| `SkyProse/ParallelProgrammingTex` | `2a18af19fb696cb7c6780115bc4caf8cbf622807` | 2026-10-24 | Existing Concurrency Theatre implementation |

`upstreams.lock.json` records the immutable commit and tree identifiers. `editions/ru/` contains **all 152 tracked files** from the Russian input, not a selection of chapters. Its Git tree must equal `e7b5ad96ee4ed0b87957b5620041d5b17a5eb9d0`; the test reconstructs that tree from bytes without relying on a local Git checkout. The 16 newly imported C fragments also have individually checked blob IDs.

## Important correction to the initial file-count comparison

Missing filenames were not sufficient evidence of missing topics. The Russian edition inserted chapters and renumbered the following material:

| Russian source | English working file | Decision |
|---|---|---|
| `section2_6.tex`: profiling | `section2_6.tex` | Newly adapted into English |
| `section3_3.tex`: Intel IPP | `intelIPP.tex` | Newly adapted, with explicit historical-code caveats |
| `section3_4.tex`: OpenMP | `section3_3.tex` | Existing English chapter retained |
| `section3_5.tex`: POSIX Threads | `posixThreads.tex` | Newly adapted; corrected executable counterpart added |
| `section3_6.tex`: OpenCL | `section3_4.tex` | Already present; not duplicated |
| `section3_7.tex`: concurrency errors | `section3_5.tex` | Already present; not duplicated |

Keeping the established English filenames preserves the source links used by the interactive curriculum. The displayed subsection order now includes IPP before OpenMP and POSIX before OpenCL. These are editorial adaptations, not a claim of a line-for-line certified translation.

## Merge decisions

The English upstream adds title pages, logos, translated figures, language fixes and corrections to three C++ snippets. Its archival `main.pdf` is retained as the binary from that upstream; it is **not** the integrated book preview.

Four files required a three-way textual merge: `main.tex`, `section1_8.tex`, `section2_5.tex` and `section3_5.tex`. CRLF/LF differences were normalized for the merge. The following 2026 corrections were retained rather than overwritten by older prose: CAS weak/strong semantics, the absence of a universal lock-free speed multiplier, C++ data-race undefined behavior, timing/statistical qualifications and the portable XeLaTeX build. The English upstream's `babel` language selection, title pages, figure numbering and text fixes were also retained.

Laboratories 5 (POSIX Threads) and 6 (OpenCL), previously commented out of `main.tex`, are included. Lab 5 now correctly starts from lab 4 rather than referring to itself. The latest Russian bibliography includes the actor-model URL correction. The November 2021 lab-1 requirements are reflected in the English task: 100 repetitions, a five-second upper target and the corrected historical ICC spelling. A separate `lab1Example2026.cpp` sketch updates the iteration count; the original 50-iteration file is not silently rewritten.

## Historical defects are not certified examples

The imported files remain exact copies. `WithPosix.c` checks `pthread_create` against `-1`, omits the thread-function return and does not adequately manage failed creation. The mutex fragments use non-standard `void *` arithmetic and omit surrounding declarations. The IPP comparison uses integer `abs` for a floating-point result and requires API-signature verification. `OpenCLKernelExample.c` contains malformed source construction, a `sifeod` typo and mismatched argument setup. Preserving these files does not validate them.

`native/pthreads_add.c` is a separate, corrected C11 example: strict compilation, checked input, checked allocation and thread API results, non-overlapping partitions, argument lifetime through joining, and element-by-element output validation. It is not a benchmark and is not presented as evidence of a speedup. Tests cover uneven partitions, an empty input, more threads than data and invalid arguments.

## Building and verifying

```sh
# Model, integration, provenance and native C/C++ tests (Node 22 or newer)
node --test web/tests/*.test.js tests/*.test.js

# Browser application
cd web
npm ci --ignore-scripts
npm run build
npx playwright install chromium
npx playwright test
cd ..

# Both books (requires XeLaTeX, standard TeX Live packages and DejaVu fonts)
python3 scripts/build_books.py
```

On an Ubuntu runner, the PDF workflow installs `texlive-xetex`, `texlive-latex-extra`, `texlive-lang-cyrillic` and `fonts-dejavu-core`. Build output is confined to `build/en/` and `build/ru/`. Original PDF files and the frozen Russian source are never overwritten. An existing Chromium may be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; the default remains Playwright's pinned browser.

The Russian build uses a disposable `build/ru-source/` copy. Its typesetting adaptations replace the obsolete PSCyr requirement with installed Unicode fonts; separate ASCII control words from adjoining Cyrillic text; repair the misspelled `GustavnsonWork` reference and the Latin/Cyrillic lookalikes in math; give URLs and long identifiers break opportunities; constrain tables; widen three-digit page-number boxes; and use a 12-point layout. These changes are not applied to `editions/ru/`. The integrated English layout retains the 14-point text size and fixes its own table/URL overflow.

The build script fails on LaTeX errors, unresolved references after repeated passes or missing glyphs. Visual inspection of rendered pages is still necessary; a successful compiler exit alone is not a layout test.

## Verification evidence and limits

The original 74 model/native tests passed before integration. Eight new checks were first run failing, then made to pass. Additional regression checks protect the lab-1 repetition count and archive file count. Both books compile locally and their final logs contain no overfull boxes, undefined references or missing glyphs. The static web build succeeds.

The local managed Chromium refuses access to `localhost` with `ERR_BLOCKED_BY_ADMINISTRATOR`, so its seven attempted browser tests are **not claimed as passed locally**. The repository's browser workflow is the independent verification route. See the PR checks for its actual result. Software-GPU CI is not a measurement of physical GPU performance.

This integration is not a comprehensive modernization of every historical algorithm, bibliography entry or obsolete compiler option. Those remain identifiable historical material, with targeted corrections separated from the archival sources. No project-wide license was invented or added.

## Attribution

The original English front matter is preserved. The 2020 source credits V. V. Sosnin, P. V. Balakshin and D. S. Shilko. The 2021 Russian edition additionally credits **D. A. Pushkarev**; that attribution is retained in the snapshot and acknowledged in the integrated front matter. Upstream Git ancestry and immutable links preserve contributor provenance.
