"""중학교 원본 보기(구글 드라이브 H:) — 값 없음.
  python scripts/middle-school/study/src.py list 중1 2
  python scripts/middle-school/study/src.py text 중1 2 step3 [쪽들 예: 5,6]       PDF 글자(일부 글꼴은 한글이 깨져 나온다 → 그림으로 볼 것)
  python scripts/middle-school/study/src.py png  중1 2 step3 5,6 <출력.png> [dpi=90]  PDF 쪽 그림(이어 붙임)
  python scripts/middle-school/study/src.py hwp  중1 2 PRE-STEP "찾을 글" [뒤 줄 수=10]  교사용 한글 파일에서 찾기 (PRE-STEP | 1회 | 2회)
동아(이병민)은 학년에 「이」를 붙인다: 중1이 2
콘솔 깨지면 PYTHONIOENCODING=utf-8 로 실행.
"""
import glob, os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def folder(grade, lesson):
    book = "동아(이)" if grade.endswith("이") else "동아(윤)"
    return f"H:/내 드라이브/{grade.rstrip('이')} 족보닷컴 다운로드/{book}/{lesson}과/"


def find_pdf(grade, lesson, step):
    hits = [f for f in glob.glob(folder(grade, lesson) + "*.pdf") if step in os.path.basename(f)]
    if not hits:
        raise SystemExit(f"PDF 없음: {step}")
    return sorted(hits)[0]


def pages(arg, n):
    return [int(x) - 1 for x in arg.split(",")] if arg else list(range(n))


cmd, grade, lesson = sys.argv[1:4]
if cmd == "list":
    for f in sorted(os.listdir(folder(grade, lesson))):
        print(f)
elif cmd == "text":
    import fitz

    d = fitz.open(find_pdf(grade, lesson, sys.argv[4]))
    print("쪽 수", len(d))
    for i in pages(sys.argv[5] if len(sys.argv) > 5 else "", len(d)):
        print(f"## p{i+1}")
        print(" ¦ ".join(l.strip() for l in d[i].get_text().splitlines() if l.strip()))
elif cmd == "png":
    import fitz
    from PIL import Image

    d = fitz.open(find_pdf(grade, lesson, sys.argv[4]))
    dpi = int(sys.argv[7]) if len(sys.argv) > 7 else 90
    ims = []
    for i in pages(sys.argv[5], len(d)):
        px = d[i].get_pixmap(dpi=dpi)
        ims.append(Image.frombytes("RGB", (px.width, px.height), px.samples))
    w, h = ims[0].size
    out = Image.new("RGB", (w * len(ims), h), "white")
    for i, m in enumerate(ims):
        out.paste(m, (i * w, 0))
    out.save(sys.argv[6])
    print(out.size)
elif cmd == "hwp":
    import hwp_rich

    which, needle = sys.argv[4], sys.argv[5]
    n = int(sys.argv[6]) if len(sys.argv) > 6 else 10
    pat = {"PRE-STEP": "PRE-STEP", "1회": "예상문제 1회", "2회": "예상문제 2회"}[which]
    hits = [f for f in glob.glob(folder(grade, lesson) + "*.hwp") if pat in f and "교사용" in f]
    P = [p["text"] for p in hwp_rich.read_hwp(hits[0])]
    for i, t in enumerate(P):
        if needle in t:
            print(" || ".join(P[i : i + n]))
