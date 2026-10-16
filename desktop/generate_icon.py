"""Render the shared U + arrow mark for the Windows executable, window, and tray."""
from pathlib import Path
from io import BytesIO
import os

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
folder = root / 'src-tauri' / 'icons'
folder.mkdir(parents=True, exist_ok=True)
scale = 16
image = Image.new('RGBA', (34 * scale, 34 * scale))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 34 * scale - 1, 34 * scale - 1), 10 * scale, fill='#79ca0b')
font = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Fonts' / 'segoeuib.ttf'
symbols = font.parent / 'seguisym.ttf'
dark = '#143525'
draw.text((17 * scale, 26 * scale), 'u', fill=dark,
          font=ImageFont.truetype(str(font), 31 * scale), anchor='ms')
draw.text((32 * scale, 16 * scale), '↗', fill=dark,
          font=ImageFont.truetype(str(symbols), 19 * scale), anchor='rs')
icon = image.resize((256, 256), Image.Resampling.LANCZOS)


def write_changed(name, content):
    path = folder / name
    if not path.exists() or path.read_bytes() != content:
        path.write_bytes(content)


for name, options in (('icon.png', {}), ('icon.ico', {'sizes': [(n, n) for n in (16, 24, 32, 48, 64, 128, 256)]})):
    output = BytesIO()
    icon.save(output, format=Path(name).suffix[1:].upper(), **options)
    write_changed(name, output.getvalue())
write_changed('icon.rgba', image.resize((128, 128), Image.Resampling.LANCZOS).tobytes())
