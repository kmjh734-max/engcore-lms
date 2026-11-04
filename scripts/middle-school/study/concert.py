"""내신콘서트(동아 윤·이, 중1·중2 2학기 중간·기말 통합본) 쪽 보기 — 값 없음. 스캔 그림 PDF라 글자가 없고 쪽이 옆으로 누워 있다.
  python scripts/middle-school/study/concert.py info <학년>                      쪽 수
  python scripts/middle-school/study/concert.py png  <학년> <PDF 쪽들 예: 62,63 또는 62-65> <출력.png> [dpi=110]
      PDF 쪽(1부터)을 바로 세워 세로로 이어 붙인다. 책 쪽 번호와 PDF 쪽 번호는 다를 수 있다(쪽 아래 번호로 확인).
학년: 중1 · 중2 = 동아(윤정미), 중1이 · 중2이 = 동아(이병민).
원본 PDF는 참고파일/동아(윤)&동아(이)_내신콘서트.zip — 처음 부를 때 study/data/concert/ 에 풀어 둔다(커밋 안 함).
"""
import os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DATA = os.path.join(HERE, "data", "concert")
ZIP = os.path.join(ROOT, "참고파일", "동아(윤)&동아(이)_내신콘서트.zip")
NAMES = {
    "중1": "동아(윤)_내신콘서트_중1-2_중간기말 통합본.pdf",
    "중2": "동아(윤)_내신콘서트_중2-2_중간기말 통합본.pdf",
    "중1이": "동아(이)_내신콘서트_중1-2_중간기말 통합본.pdf",
    "중2이": "동아(이)_내신콘서트_중2-2_중간기말 통합본.pdf",
}


def pdf_path(grade):
    if grade not in NAMES:
        raise SystemExit(f"학년은 {', '.join(NAMES)} 중 하나")
    out = os.path.join(DATA, NAMES[grade])
    if not os.path.exists(out):
        os.makedirs(DATA, exist_ok=True)
        z = zipfile.ZipFile(ZIP)
        for i in z.infolist():
            n = i.filename
            try:
                n = n.encode("cp437").decode("cp949")
            except Exception:
                pass
            dst = os.path.join(DATA, os.path.basename(n))
            if not os.path.exists(dst):
                with open(dst, "wb") as f:
                    f.write(z.read(i))
    return out


def page_list(arg):
    out = []
    for part in arg.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return [p - 1 for p in out]


cmd, grade = sys.argv[1], sys.argv[2]
import fitz

d = fitz.open(pdf_path(grade))
if cmd == "info":
    print(grade, NAMES[grade], len(d), "쪽")
elif cmd == "png":
    idx = page_list(sys.argv[3])
    out = sys.argv[4]
    dpi = int(sys.argv[5]) if len(sys.argv) > 5 else 110
    pixes = []
    for i in idx:
        p = d[i]
        pix = p.get_pixmap(dpi=dpi)
        if pix.width > pix.height:  # 옆으로 누운 쪽은 바로 세운다
            pix = p.get_pixmap(dpi=dpi, matrix=fitz.Matrix(1, 1).prerotate(90))
        pixes.append(pix)
    if len(pixes) == 1:
        pixes[0].save(out)
    else:
        w = max(x.width for x in pixes)
        h = sum(x.height for x in pixes)
        doc = fitz.open()
        page = doc.new_page(width=w, height=h)
        y = 0
        for x in pixes:
            page.insert_image(fitz.Rect(0, y, x.width, y + x.height), pixmap=x)
            y += x.height
        page.get_pixmap(dpi=72).save(out)
    print("저장", out, len(idx), "쪽")
else:
    print(__doc__)
