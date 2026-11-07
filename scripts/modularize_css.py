#!/usr/bin/env python3
"""
BEST WEATHER — CSS Modularizer & Build Pipeline (ARCH-02)
Splits the monolithic style.css into cleanly delineated domain modules
and compiles them into a unified, performant style.css bundle.
"""

import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_DIR = os.path.join(BASE_DIR, 'css')
STYLE_CSS = os.path.join(BASE_DIR, 'style.css')

MODULES = [
    ('01_variables.css', 1, 92),
    ('02_base.css', 93, 522),
    ('03_overview.css', 523, 2406),
    ('04_mountain.css', 2407, 2910),
    ('05_verification.css', 2911, 4709),
    ('06_map.css', 4710, 7559),
    ('07_sports.css', 7560, 13447),
    ('08_responsive.css', 13448, 13868)
]

def split_style_css():
    os.makedirs(CSS_DIR, exist_ok=True)
    with open(STYLE_CSS, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    total_lines = len(lines)
    print(f"Reading {STYLE_CSS} ({total_lines} lines)...")

    for filename, start, end in MODULES:
        filepath = os.path.join(CSS_DIR, filename)
        # 1-based to 0-based
        mod_lines = lines[start - 1 : min(end, total_lines)]
        with open(filepath, 'w', encoding='utf-8') as out:
            out.writelines(mod_lines)
        print(f"  ✓ Created {filename} ({len(mod_lines)} lines)")

def compile_css():
    print(f"Compiling modules from {CSS_DIR} into {STYLE_CSS}...")
    compiled_lines = []
    
    header = (
        "/* ==========================================================================\n"
        "   BEST WEATHER — DYNAMIC RESPONSIVE DESIGN SYSTEM (ARCH-02 MODULARIZED)\n"
        "   Compiled from /css domain modules:\n"
        "     - 01_variables.css\n"
        "     - 02_base.css\n"
        "     - 03_overview.css\n"
        "     - 04_mountain.css\n"
        "     - 05_verification.css\n"
        "     - 06_map.css\n"
        "     - 07_sports.css\n"
        "     - 08_responsive.css\n"
        "   ========================================================================== */\n\n"
    )
    compiled_lines.append(header)

    for filename, _, _ in MODULES:
        filepath = os.path.join(CSS_DIR, filename)
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
                compiled_lines.append(content)
                if not content.endswith('\n'):
                    compiled_lines.append('\n')

    with open(STYLE_CSS, 'w', encoding='utf-8') as f:
        f.writelines(compiled_lines)

    print(f"  ✓ Successfully compiled {STYLE_CSS} ({len(compiled_lines)} parts)")

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'build':
        compile_css()
    else:
        split_style_css()

