#!/usr/bin/env python3
"""Build both editions without changing the byte-exact Russian snapshot.

Requires XeLaTeX, common TeX Live packages and the DejaVu fonts.
Generated sources, logs and PDFs live exclusively under build/.
"""
from __future__ import annotations
import argparse
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FONT_SETUP = r'''
\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{russian}
\setotherlanguage{english}
\setmainfont[AutoFakeSlant=0.18]{DejaVu Serif}
\setsansfont{DejaVu Sans}
\setmonofont{DejaVu Sans Mono}
\newfontfamily\cyrillicfont[AutoFakeSlant=0.18]{DejaVu Serif}
\newfontfamily\cyrillicfonttt{DejaVu Sans Mono}
\emergencystretch=3em
\usepackage{xurl}
\usepackage{adjustbox}
\makeatletter
\renewcommand{\@pnumwidth}{2.8em}
\renewcommand{\@tocrmarg}{3.5em}
\makeatother
'''

def prepare_russian() -> Path:
    source = ROOT / 'editions/ru'
    stage = ROOT / 'build/ru-source'
    if stage.exists():
        shutil.rmtree(stage)
    shutil.copytree(source, stage)
    # XeTeX treats Cyrillic letters as letters, unlike the old 8-bit engine.
    # Insert command boundaries in a disposable typesetting copy, not the archive.
    for file in stage.glob('*.tex'):
        text = file.read_text(encoding='utf-8')
        text = re.sub(r'\\([A-Za-z]+)(?=[\u0400-\u04ff])', r'\\\1 ', text)
        text = text.replace('GustavnsonWork:equation', 'GustavsonWork:equation')
        text = text.replace('$\u041c$', '$M$').replace('$\u0430$', '$a$')
        if file.name == 'bibliography.tex':
            text = re.sub(r'\\href\{([^}]*)\}\s*\{([^}]*)\}',
                          lambda m: '\\href{' + m[1] + '}{\\nolinkurl{' + m[2].replace('\\_', '_') + '}}', text)
        if file.name in {'section3_4.tex', 'section4_4.tex'}:
            text = text.replace(r'\begin{tabular}', r'\begin{adjustbox}{max width=\linewidth}\begin{tabular}')
            text = text.replace(r'\end{tabular}', r'\end{tabular}\end{adjustbox}')
        if file.name in {'section2_5.tex', 'section3_6.tex', 'section5_1.tex'}:
            text = text.replace('{ %', '{\\sloppy %', 1)
        if file.name == 'section3_6.tex':
            for identifier in ['clCreateContextFromType', 'clCreateCommandQueueWithProperties', 'clCreateProgramWithSource']:
                text = text.replace(identifier, re.sub(r'([a-z])([A-Z])', r'\1\\allowbreak \2', identifier))
        file.write_text(text, encoding='utf-8')
    main = stage / 'main.tex'
    text = main.read_text(encoding='utf-8').replace('[14pt]{extarticle}', '[12pt]{extarticle}')
    text = re.sub(r'\\usepackage\[utf8\]\{inputenc\}', '', text)
    text = re.sub(r'\\usepackage\[russian\]\{babel\}', lambda _: FONT_SETUP, text)
    text = re.sub(r'\\usepackage\{pscyr\}[^\n]*', '', text)
    text = re.sub(r'\\renewcommand\{\\rmdefault\}\{ftm\}', '', text)
    text = re.sub(r'\\usepackage\{xr\}[^\n]*', '', text)
    text = re.sub(r'\\externaldocument\{main\}[^\n]*', '', text)
    text = text.replace('extendedchars=\\true', 'extendedchars=true')
    text = text.replace('belowskip=-2.5em,', 'belowskip=0.6em,')
    main.write_text(text, encoding='utf-8')
    return stage

def build(language: str) -> Path:
    cwd = ROOT if language == 'en' else prepare_russian()
    output = ROOT / 'build' / language
    output.mkdir(parents=True, exist_ok=True)
    command = ['xelatex', '-interaction=nonstopmode', '-halt-on-error',
               '-file-line-error', '-no-shell-escape', f'-output-directory={output}', 'main.tex']
    for number in range(1, 5):
        run = subprocess.run(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log = run.stdout.decode('utf-8', errors='replace')
        (output / f'pass-{number}.txt').write_text(log, encoding='utf-8')
        if run.returncode:
            raise RuntimeError(f'{language}: XeLaTeX failed; see {output / f"pass-{number}.txt"}\n{log[-2500:]}')
        unresolved = 'There were undefined references' in log
        rerun = 'Rerun to get cross-references right' in log or 'Rerun to get /PageLabels entry' in log
        if number >= 3 and not (unresolved or rerun):
            break
    else:
        raise RuntimeError(f'{language}: references did not converge; inspect {output / "main.log"}')
    if 'Missing character:' in log:
        raise RuntimeError(f'{language}: missing glyphs; inspect {output / "main.log"}')
    final = output / f'parallel-programming-{language}.pdf'
    shutil.copy2(output / 'main.pdf', final)
    print(final)
    return final

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--edition', choices=['en', 'ru', 'both'], default='both')
    args = parser.parse_args()
    if not shutil.which('xelatex'):
        parser.error('XeLaTeX is required; install TeX Live XeTeX and the packages documented in docs/INTEGRATION.md')
    for language in (['en', 'ru'] if args.edition == 'both' else [args.edition]):
        build(language)

if __name__ == '__main__':
    main()
