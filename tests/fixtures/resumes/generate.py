"""Builds sample-resume.docx and sample-resume.pdf from sample-resume.txt.

Run with: python3 tests/fixtures/resumes/generate.py
The outputs are committed so tests do not need Python. Bullet lines ("• ...")
become real Word list items in the DOCX and literal bullets in the PDF.
"""
import pathlib
import zipfile
from xml.sax.saxutils import escape

HERE = pathlib.Path(__file__).parent
LINES = (HERE / "sample-resume.txt").read_text(encoding="utf-8").splitlines()

# ------------------------------------------------------------------ DOCX
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

def paragraph(text):
    if text.startswith("• "):
        props = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
        text = text[2:]
    elif text.isupper() and len(text) < 30 and text != LINES[0]:
        props = '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
    else:
        props = ""
    return f'<w:p>{props}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'

body = "".join(paragraph(line) for line in LINES if line.strip())
document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}</w:body></w:document>'
numbering = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {W}>'
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
)
styles = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {W}>'
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>'
)
content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    '</Types>'
)
rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '</Relationships>'
)
doc_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    '</Relationships>'
)
with zipfile.ZipFile(HERE / "sample-resume.docx", "w", zipfile.ZIP_DEFLATED) as docx:
    for name, data in [
        ("[Content_Types].xml", content_types),
        ("_rels/.rels", rels),
        ("word/_rels/document.xml.rels", doc_rels),
        ("word/document.xml", document),
        ("word/numbering.xml", numbering),
        ("word/styles.xml", styles),
    ]:
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        docx.writestr(info, data)

# ------------------------------------------------------------------ PDF
def pdf_string(text):
    raw = text.encode("cp1252")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")

def page_stream(lines):
    ops = [b"BT /F1 9 Tf 11 TL 40 760 Td"]
    for line in lines:
        ops.append(b"(" + pdf_string(line) + b") Tj T*")
    ops.append(b"ET")
    return b"\n".join(ops)

text_lines = [line for line in LINES]
pages = [text_lines[:34], text_lines[34:]]
objects = []
objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
kids = " ".join(f"{4 + i * 2} 0 R" for i in range(len(pages)))
objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
for i, lines in enumerate(pages):
    stream = page_stream(lines)
    objects.append(
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {5 + i * 2} 0 R >>".encode()
    )
    objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")

out = bytearray(b"%PDF-1.4\n")
offsets = []
for number, body in enumerate(objects, start=1):
    offsets.append(len(out))
    out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
xref = len(out)
out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
for offset in offsets:
    out += f"{offset:010d} 00000 n \n".encode()
out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
(HERE / "sample-resume.pdf").write_bytes(bytes(out))
print("wrote sample-resume.docx and sample-resume.pdf")
